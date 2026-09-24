import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createLifecycleManager,
  createRecordingExecutor,
  lifecycleExecution,
  type LifecycleTask,
} from "../../helpers/lifecycle.test.helpers";

const strictTask: LifecycleTask = {
  id: "durable-tests-restart-input-validation",
  inputSchema: {
    parse: (value: unknown) => {
      if (value !== "ok") throw new Error("input must be ok");
      return value;
    },
  },
} as any;

async function seedFailedContinuation(store: MemoryStore): Promise<void> {
  // A continued run whose carried input never passed validation.
  await store.saveExecution(
    lifecycleExecution({
      id: "continued",
      workflowKey: strictTask.id,
      input: "bad",
      inputNeedsValidation: true,
      continuedFromExecutionId: "root",
      status: ExecutionStatus.Failed,
      error: { message: "input must be ok" },
    }),
  );
}

describe("durable: restart input validation", () => {
  it("rejects reused unvalidated input up front when the task is registered", async () => {
    const store = new MemoryStore();
    await seedFailedContinuation(store);
    const { executor, inputs } = createRecordingExecutor();
    const manager = createLifecycleManager({
      store,
      task: strictTask,
      taskExecutor: executor,
    });

    await expect(manager.restartExecution("continued")).rejects.toThrow(
      "input must be ok",
    );
    expect(await store.listExecutions()).toHaveLength(1);
    expect(inputs).toEqual([]);
  });

  it("carries the validation flag forward when the task lives on workers", async () => {
    const store = new MemoryStore();
    await seedFailedContinuation(store);
    const operator = createLifecycleManager({ store });
    const { executor, inputs } = createRecordingExecutor();
    const worker = createLifecycleManager({
      store,
      task: strictTask,
      taskExecutor: executor,
    });

    const restartedId = await operator.restartExecution("continued");
    expect((await store.getExecution(restartedId))?.inputNeedsValidation).toBe(
      true,
    );

    await worker.processExecution(restartedId);
    expect(await store.getExecution(restartedId)).toMatchObject({
      status: ExecutionStatus.Failed,
    });
    expect(inputs).toEqual([]);
  });

  it("does not flag input that was validated at the original start", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "validated",
        workflowKey: strictTask.id,
        input: "ok",
      }),
    );
    const operator = createLifecycleManager({ store });

    const restartedId = await operator.restartExecution("validated");

    expect(
      (await store.getExecution(restartedId))?.inputNeedsValidation,
    ).toBeUndefined();
  });
});
