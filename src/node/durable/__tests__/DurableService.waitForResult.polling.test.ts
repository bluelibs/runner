import { DurableExecutionError, DurableService } from "../core/DurableService";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableService waitForResult (polling)", () => {
  it("rejects when execution enters compensation_failed", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, polling: { interval: 1 } });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      error: { message: "rollback blew up" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.wait("e1", { timeout: 5_000 })).rejects.toMatchObject({
      message: "rollback blew up",
      executionId: "e1",
      taskId: "t",
    });
  });

  it("uses a default message when compensation_failed has no error", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, polling: { interval: 1 } });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.wait("e1", { timeout: 5_000 })).rejects.toMatchObject({
      message: "Compensation failed",
    });
  });

  it("includes execution metadata when timing out", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, polling: { interval: 1 } });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 2,
      maxAttempts: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockImplementationOnce(() => 1_000);
    nowSpy.mockImplementationOnce(() => 1_000 + 10);

    try {
      await expect(
        service.wait("e1", { timeout: 5, waitPollIntervalMs: 1 }),
      ).rejects.toMatchObject({
        taskId: "t",
        attempt: 2,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("uses 'unknown' metadata if the execution disappears right when timing out", async () => {
    class TimeoutFetchMissingStore extends MemoryStore {
      private callCount = 0;

      override async getExecution(id: string) {
        this.callCount += 1;
        if (this.callCount === 3) {
          return null;
        }
        return await super.getExecution(id);
      }
    }

    const store = new TimeoutFetchMissingStore();
    const service = new DurableService({ store, polling: { interval: 1 } });

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockImplementationOnce(() => 2_000);
    nowSpy.mockImplementationOnce(() => 2_000 + 10);

    try {
      const promise = service.wait("e1", { timeout: 5, waitPollIntervalMs: 1 });
      await expect(promise).rejects.toBeInstanceOf(DurableExecutionError);
      await expect(promise).rejects.toMatchObject({
        taskId: "unknown",
        attempt: 0,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
