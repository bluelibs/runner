import { r } from "../../../../..";
import { genericError } from "../../../../../errors";
import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("durable: ExecutionManager timeout classification", () => {
  it("does not treat user task errors with timeout-shaped messages as real timeouts", async () => {
    const store = new MemoryStore();
    const executionId = "timeout-message-collision";
    const task = r
      .task("t-timeout-message-collision")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw genericError.new({
            message: `Execution ${executionId} timed out`,
          });
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 2 },
    });

    await store.saveExecution({
      ...pendingExecution({
        workflowKey: task.id,
        maxAttempts: 2,
      }),
      id: executionId,
    });

    await service.processExecution(executionId);

    const execution = await store.getExecution(executionId);
    const retryTimers = await store.getReadyTimers(
      new Date(Date.now() + 60_000),
    );

    expect(execution?.status).toBe("retrying");
    expect(execution?.attempt).toBe(2);
    expect(execution?.error?.message).toBe(
      `Execution ${executionId} timed out`,
    );
    expect(retryTimers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId,
          type: "retry",
        }),
      ]),
    );
  });
});
