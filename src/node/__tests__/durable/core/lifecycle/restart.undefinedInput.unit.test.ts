import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createLifecycleManager,
  lifecycleExecution,
} from "../../helpers/lifecycle.test.helpers";

describe("durable: restart with undefined input", () => {
  it("uses an explicit undefined override instead of the source input", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      lifecycleExecution({
        id: "source",
        workflowKey: "durable-tests-undefined-input",
        input: { original: true },
        status: ExecutionStatus.Completed,
      }),
    );
    const manager = createLifecycleManager({ store });

    const restartedId = await manager.restartExecution("source", {
      input: undefined,
    });

    expect(await store.getExecution(restartedId)).toMatchObject({
      restartedFromExecutionId: "source",
      input: undefined,
      inputNeedsValidation: true,
    });
  });
});
