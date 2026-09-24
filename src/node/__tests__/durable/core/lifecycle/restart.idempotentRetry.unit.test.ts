import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";
import {
  createLifecycleManager,
  createRecordingExecutor,
  lifecycleExecution,
  type LifecycleTask,
} from "../../helpers/lifecycle.test.helpers";

const task: LifecycleTask = {
  id: "durable-tests-restart-idempotent-retry",
} as any;

async function seedPausedSource(store: MemoryStore): Promise<void> {
  await store.saveExecution(
    lifecycleExecution({
      id: "src",
      workflowKey: task.id,
      input: "in",
      status: ExecutionStatus.Paused,
      pausedAt: new Date(),
      pausedFrom: ExecutionStatus.Sleeping,
    }),
  );
}

async function resumeSource(store: MemoryStore): Promise<void> {
  await store.updateExecution("src", {
    status: ExecutionStatus.Sleeping,
    pausedFrom: undefined,
  });
}

function restartedFromSource(executions: Execution[]): Execution[] {
  return executions.filter((e) => e.restartedFromExecutionId === "src");
}

describe("durable: idempotent restart retries", () => {
  it("returns the linked restart for a retried key after the source resumed", async () => {
    const store = new MemoryStore();
    await seedPausedSource(store);
    const manager = createLifecycleManager({
      store,
      task,
      taskExecutor: createRecordingExecutor().executor,
    });

    const first = await manager.restartExecution("src", {
      idempotencyKey: "k",
    });
    await resumeSource(store);

    await expect(
      manager.restartExecution("src", { idempotencyKey: "k" }),
    ).resolves.toBe(first);
    expect(restartedFromSource(await store.listExecutions())).toHaveLength(1);
  });

  it("never cancels a successor another same-key caller already returned", async () => {
    const base = new MemoryStore();
    await seedPausedSource(base);
    const executor = createRecordingExecutor().executor;
    const secondCaller = createLifecycleManager({
      store: base,
      task,
      taskExecutor: executor,
    });
    let secondResult: string | undefined;
    const racingStore = createBareStore(base, {
      createExecutionWithIdempotencyKey: async (params) => {
        const created = await base.createExecutionWithIdempotencyKey(params);
        // Caller 2 dedupes onto the fresh id and links it, then the source
        // resumes before caller 1 reaches its own link.
        secondResult = await secondCaller.restartExecution("src", {
          idempotencyKey: "k",
        });
        await resumeSource(base);
        return created;
      },
    });
    const firstCaller = createLifecycleManager({
      store: racingStore,
      task,
      taskExecutor: executor,
    });

    const firstResult = await firstCaller.restartExecution("src", {
      idempotencyKey: "k",
    });

    expect(firstResult).toBe(secondResult);
    expect((await base.getExecution(firstResult))?.status).toBe(
      ExecutionStatus.Completed,
    );
  });

  it("rejects without cancelling an unlinked successor while the source is active", async () => {
    const base = new MemoryStore();
    await seedPausedSource(base);
    const bystander = createLifecycleManager({ store: base, task });
    let bystanderError: unknown;
    const racingStore = createBareStore(base, {
      createExecutionWithIdempotencyKey: async (params) => {
        const created = await base.createExecutionWithIdempotencyKey(params);
        // The source resumes before either caller links; the bystander
        // must not cancel the creator's successor out from under it.
        await resumeSource(base);
        await base.updateExecution("src", { restartedAsExecutionId: "old" });
        bystanderError = await bystander
          .restartExecution("src", { idempotencyKey: "k" })
          .catch((error: unknown) => error);
        const successor = await base.getExecution(created.executionId);
        expect(successor?.status).toBe(ExecutionStatus.Pending);
        return created;
      },
    });
    const creator = createLifecycleManager({ store: racingStore, task });

    await expect(
      creator.restartExecution("src", { idempotencyKey: "k" }),
    ).rejects.toThrow('with status "sleeping"');
    expect(String(bystanderError)).toContain('with status "sleeping"');
    const [orphan] = restartedFromSource(await base.listExecutions());
    expect(orphan?.status).toBe(ExecutionStatus.Cancelled);
  });

  it("rejects a never-restarted active source without minting a successor", async () => {
    const store = new MemoryStore();
    await seedPausedSource(store);
    await resumeSource(store);
    const manager = createLifecycleManager({ store, task });

    await expect(
      manager.restartExecution("src", { idempotencyKey: "k" }),
    ).rejects.toThrow('with status "sleeping"');
    expect(await store.listExecutions()).toHaveLength(1);
  });
});
