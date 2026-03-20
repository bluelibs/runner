import { DurableService } from "../../durable/core/DurableService";
import { ExecutionStatus, type Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

function exec(id: string, status: ExecutionStatus): Execution {
  return {
    id,
    taskId: "t",
    input: undefined,
    status,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: DurableService.recover branch coverage", () => {
  it("recovers all incomplete executions in queue mode", async () => {
    class InconsistentStore extends MemoryStore {
      override async listIncompleteExecutions(): Promise<Execution[]> {
        return [
          exec("e-pending", ExecutionStatus.Pending),
          exec("e-running", ExecutionStatus.Running),
          exec("e-sleeping", ExecutionStatus.Sleeping),
          exec("e-done", ExecutionStatus.Completed),
          exec("e-failed", ExecutionStatus.Failed),
        ];
      }
    }

    const store = new InconsistentStore();
    const service = new DurableService({
      store,
      tasks: [],
      queue: {
        enqueue: jest.fn(async () => "m1"),
        consume: jest.fn(async () => {}),
        ack: jest.fn(async () => {}),
        nack: jest.fn(async () => {}),
      },
    });
    const kickoffSpy = jest
      .spyOn(
        (
          service as unknown as {
            executionManager: {
              kickoffExecution: (id: string) => Promise<void>;
            };
          }
        ).executionManager,
        "kickoffExecution",
      )
      .mockResolvedValue(undefined);

    await service.recover();

    expect(kickoffSpy).toHaveBeenCalledWith("e-pending");
    expect(kickoffSpy).toHaveBeenCalledWith("e-running");
    expect(kickoffSpy).toHaveBeenCalledWith("e-sleeping");
    expect(kickoffSpy).toHaveBeenCalledTimes(3);
    expect(kickoffSpy).not.toHaveBeenCalledWith("e-done");
    expect(kickoffSpy).not.toHaveBeenCalledWith("e-failed");
  });

  it("still recovers pending executions when no queue is configured", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const kickoffSpy = jest
      .spyOn(
        (
          service as unknown as {
            executionManager: {
              kickoffExecution: (id: string) => Promise<void>;
            };
          }
        ).executionManager,
        "kickoffExecution",
      )
      .mockResolvedValue(undefined);

    await store.saveExecution(exec("e-pending", ExecutionStatus.Pending));

    await service.recover();

    expect(kickoffSpy).toHaveBeenCalledWith("e-pending");
  });
});
