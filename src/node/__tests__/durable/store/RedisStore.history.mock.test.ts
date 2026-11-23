import { pendingExecution } from "../helpers/DurableService.unit.helpers";
import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";
import type { DurableCheckpointBranch } from "../../../durable/core/interfaces/history";

const harness = setupRedisStoreMock();

describe("Redis ordered checkpoint history", () => {
  it("preserves application serialization and sorts metadata by invocation order", async () => {
    const { store, redisMock } = harness;
    expect(await store.listExecutionHistory("none")).toEqual([]);
    await store.recordExecutionHistory("run", {
      stepId: "work",
      kind: "step",
      phase: "started",
    });
    await store.recordExecutionHistory("run", {
      stepId: "__origin",
      kind: "origin",
      phase: "completed",
      stateAfter: null,
    });
    await store.recordExecutionHistory("run", {
      stepId: "state",
      kind: "state",
      phase: "completed",
      stateAfter: { value: { n: 2n } },
    });
    redisMock.hgetall.mockResolvedValue({
      work: JSON.stringify({ stepId: "work", kind: "step", startedOrder: 5 }),
      initial: JSON.stringify({
        stepId: "__origin",
        kind: "origin",
        startedOrder: 1,
        completedOrder: 2,
        statePayload: null,
      }),
      state: JSON.stringify({
        stepId: "state",
        kind: "state",
        startedOrder: 3,
        completedOrder: 4,
        statePayload: serializer.stringify({ value: { n: 2n } }),
      }),
    });
    const history = await store.listExecutionHistory("run");
    expect(history.map((entry) => entry.stepId)).toEqual([
      "__origin",
      "state",
      "work",
    ]);
    expect(history[1].stateAfter).toEqual({ value: { n: 2n } });
    redisMock.hgetall.mockResolvedValue({ bad: "{}" });
    await expect(store.listExecutionHistory("run")).rejects.toThrow();
  });

  it("prepares one opaque atomic commit for all branch records", async () => {
    const { store, redisMock } = harness;
    const execution = pendingExecution({ id: "new", historyRecorded: true });
    const branch: DurableCheckpointBranch = {
      expected: pendingExecution({ id: "source", status: "paused" }),
      execution,
      state: { value: { cursor: 3n } },
      steps: [
        {
          executionId: "new",
          stepId: "first",
          result: 3,
          completedAt: new Date(0),
        },
      ],
      history: [
        {
          kind: "origin",
          stepId: "__origin",
          startedOrder: 1,
          completedOrder: 2,
          stateAfter: null,
        },
        {
          kind: "state",
          stepId: "state",
          startedOrder: 3,
          completedOrder: 4,
          stateAfter: { value: { cursor: 3n } },
        },
        { kind: "step", stepId: "first", startedOrder: 5 },
      ],
    };
    expect(await store.createCheckpointExecution(branch)).toBe(false);
    redisMock.get.mockResolvedValue(
      serializer.stringify({ ...branch.expected, attempt: 2 }),
    );
    expect(await store.createCheckpointExecution(branch)).toBe(false);
    redisMock.get.mockResolvedValue(serializer.stringify(branch.expected));
    expect(await store.createCheckpointExecution(branch)).toBe(true);
    expect(redisMock.eval.mock.calls[0][0]).toContain(
      'redis.call("get", KEYS[1]) ~= ARGV[1]',
    );
    expect(redisMock.eval.mock.calls[0][1]).toBe(10);
    redisMock.eval.mockResolvedValueOnce(0);
    expect(
      await store.createCheckpointExecution({ ...branch, state: null }),
    ).toBe(false);
  });
});
