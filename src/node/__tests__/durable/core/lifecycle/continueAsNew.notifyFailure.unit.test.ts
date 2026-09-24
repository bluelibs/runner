import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { continueExecutionAsNew } from "../../../../durable/core/managers/ExecutionManager.continueAsNew";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";
import { lifecycleExecution } from "../../helpers/lifecycle.test.helpers";

describe("durable: continueExecutionAsNew waiter hand-off failure", () => {
  it("still kicks the committed successor and surfaces the notify error", async () => {
    const store = new MemoryStore();
    const running = lifecycleExecution({
      id: "root",
      workflowKey: "wf",
      status: ExecutionStatus.Running,
    });
    await store.saveExecution(running);
    const kickoffExecution = jest.fn(async () => undefined);

    await expect(
      continueExecutionAsNew({
        deps: {
          persistence: {
            store,
            auditLogger: new AuditLogger({ enabled: false }, store),
            getTaskWorkflowKey: () => "wf",
            maxAttempts: 1,
            kickoffFailsafeDelayMs: 0,
            kickoffExecution,
          },
          notifyFinished: async () =>
            genericError.throw({ message: "waiter-lock-busy" }),
        },
        runningExecution: running,
        nextInput: { page: 2 },
        logStatusChange: async () => undefined,
        finalizeCancellation: async () => false,
      }),
    ).rejects.toThrow("waiter-lock-busy");

    const successorId = (await store.getExecution("root"))
      ?.continuedAsExecutionId;
    expect(successorId).toEqual(expect.any(String));
    expect(kickoffExecution).toHaveBeenCalledWith(successorId);
  });
});
