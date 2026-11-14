import { Serializer } from "../../../../serializer";
import { randomUUID } from "node:crypto";
import {
  RedisStore,
  type RedisClient,
} from "../../../durable/store/RedisStore";
import { createIORedisClient } from "../../../durable/optionalDeps/ioredis";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";
import { DurableOperator } from "../../../durable/core/DurableOperator";
import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import { r, resources, run, tags } from "../../..";
import { durableResource } from "../../../durable/core/resource";

const enabled = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ?? "redis://localhost:6379";

(enabled ? describe : describe.skip)("Redis workflow capabilities", () => {
  const prefix = `runner:capabilities:${randomUUID()}:`;
  let store: RedisStore;
  let other: RedisStore;
  let disposedByRuntime = false;
  beforeEach(() => {
    disposedByRuntime = false;
    store = new RedisStore({
      redis: redisUrl,
      prefix,
      serializer: new Serializer({ pretty: true }),
    });
    other = new RedisStore({ redis: redisUrl, prefix });
  });
  afterEach(async () => {
    const client = createIORedisClient(redisUrl) as RedisClient;
    await client.eval(
      'local keys = redis.call("keys", ARGV[1]); if #keys > 0 then return redis.call("del", unpack(keys)) end; return 0',
      0,
      `${prefix}*`,
    );
    await client.quit();
    if (!disposedByRuntime) await store.dispose();
    await other.dispose();
  });

  it("fences a stale command and commits its receipt, state, and ordered history together", async () => {
    const execution = pendingExecution({
      id: "exact/id:a",
      workflowKey: "workflow",
      historyRecorded: true,
    });
    await store.saveExecution(execution);
    await store.recordExecutionHistory(execution.id, {
      stepId: "__origin",
      kind: "origin",
      phase: "completed",
      stateAfter: null,
    });
    const command: DurableCommandRecord = {
      id: "request/id:a",
      requestedExecutionId: execution.id,
      executionId: execution.id,
      taskKey: "app.tasks.change",
      input: { n: 1 },
      createdAt: new Date(),
      status: "pending",
    };
    const [first, duplicate] = await Promise.all([
      store.enqueueCommand(command),
      other.enqueueCommand({ ...command, input: { n: 2 } }),
    ]);
    expect(first.input).toEqual(duplicate.input);
    expect(await store.getNextCommand(execution.id)).toMatchObject({
      id: command.id,
    });
    const lockId = await store.acquireLock(`execution:${execution.id}`, 30000);
    const owned = store.withExecutionOwnership({
      executionId: execution.id,
      lockId: lockId!,
      onLost: () => {
        throw new Error("stale owner");
      },
    });
    const staged = {
      ...command,
      status: "running" as const,
      stateInitialized: true,
      state: { value: { count: 4n } },
    };
    expect(await owned.saveCommand!(staged)).toBe(true);
    await store.releaseLock(`execution:${execution.id}`, lockId!);
    await expect(
      owned.completeCommand!({ ...staged, status: "completed" }, execution),
    ).rejects.toThrow("stale owner");
    expect(await other.getWorkflowState(execution.id)).toBeNull();
    expect(
      await other.completeCommand(
        {
          ...staged,
          status: "completed",
          result: "accepted",
          completedAt: new Date(),
        },
        execution,
      ),
    ).toBe(true);
    expect(await store.getWorkflowState(execution.id)).toMatchObject({
      state: { count: 4n },
    });
    expect(await store.getCommand(command.id)).toMatchObject({
      result: "accepted",
      status: "completed",
    });
    expect(await store.getNextCommand(execution.id)).toBeNull();
    expect(
      (await store.listExecutionHistory(execution.id)).map(
        (entry) => entry.kind,
      ),
    ).toEqual(["origin", "command"]);
    expect(await store.completeCommand({ ...staged, status: "failed" })).toBe(
      false,
    );
    expect(await store.saveCommand(staged)).toBe(false);
  });

  it("branches a recorded checkpoint atomically, including state and query indexes", async () => {
    const execution = pendingExecution({
      id: "source/a",
      workflowKey: "checkout",
      workflowVersion: 2,
      status: "completed",
      historyRecorded: true,
    });
    await store.saveExecution(execution);
    await store.recordExecutionHistory(execution.id, {
      kind: "origin",
      stepId: "__origin",
      phase: "completed",
      stateAfter: null,
    });
    await store.recordExecutionHistory(execution.id, {
      kind: "state",
      stepId: "__state:initial",
      phase: "completed",
      stateAfter: { value: { count: 3n } },
    });
    await store.saveStepResult({
      executionId: execution.id,
      stepId: "__state:initial",
      result: undefined,
      completedAt: new Date(),
    });
    await store.recordExecutionHistory(execution.id, {
      kind: "step",
      stepId: "charge",
      phase: "completed",
    });
    const operator = new DurableOperator(other);
    const options = {
      beforeStep: "charge",
      reason: "Correct payment",
      idempotencyKey: "same",
    };
    const branch = await operator.reset(execution.id, options);
    expect(await new DurableOperator(other).reset(execution.id, options)).toBe(
      branch,
    );
    expect(await store.getExecution(branch)).toMatchObject({
      workflowVersion: 2,
      resetFromExecutionId: execution.id,
      status: "pending",
    });
    expect(await store.getWorkflowState(branch)).toMatchObject({
      state: { count: 3n },
    });
    expect(await store.getStepResult(branch, "__state:initial")).not.toBeNull();
    expect(await store.getStepResult(branch, "charge")).toBeNull();
    expect(
      (await store.listExecutionStates({ workflowKey: "checkout" })).some(
        (entry) => entry.id === branch,
      ),
    ).toBe(true);
    expect(
      (await store.listExecutionHistory(branch)).map((entry) => entry.stepId),
    ).toEqual(["__origin", "__state:initial"]);
    expect((await store.getExecution(execution.id))?.status).toBe("completed");
  });

  it("runs normal Runner commands against Redis with application context and state", async () => {
    const durable = durableResource.fork("redis-command");
    const change = r
      .task("change")
      .dependencies({ durable })
      .run(async (n: number, { durable }) => {
        await durable.use().replaceState({ n });
        return n * 2;
      })
      .build();
    const workflow = r
      .task("workflow")
      .dependencies({ durable })
      .tags([tags.durableWorkflow.with({ commands: [change], version: 1 })])
      .run(async (_: undefined, { durable }) => {
        await durable.use().sleep(60000);
        return true;
      })
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.durable,
          workflow,
          change,
          durable.with({ store, timers: { enabled: false } }),
        ])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      const backend = runtime.getResourceValue(durable);
      const id = await backend.start(workflow);
      expect(
        await backend.command(id, change, 7, { idempotencyKey: "request" }),
      ).toBe(14);
      expect(await backend.getState(id)).toEqual({ n: 7 });
      expect(
        await backend.command(id, change, 9, { idempotencyKey: "request" }),
      ).toBe(14);
    } finally {
      await runtime.dispose();
      disposedByRuntime = true;
    }
  });
});
