import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createLifecycleManager,
  lifecycleExecution,
} from "../../helpers/lifecycle.test.helpers";

describe("durable: resume lineage validation", () => {
  it("fails fast when a continuation parent is missing", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "tip",
        workflowKey: "durable-tests-resume-lineage",
        status: ExecutionStatus.Paused,
        continuedFromExecutionId: "missing",
      }),
    );

    await expect(
      createLifecycleManager({ store }).resumeExecution("tip"),
    ).rejects.toThrow("Continuation parent 'missing' is missing");
  });

  it("fails fast on a cycle in continuation ancestry", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "tip",
        workflowKey: "durable-tests-resume-lineage",
        status: ExecutionStatus.Paused,
        continuedFromExecutionId: "tip",
      }),
    );

    await expect(
      createLifecycleManager({ store }).resumeExecution("tip"),
    ).rejects.toThrow("Continuation ancestry contains a cycle");
  });
});
