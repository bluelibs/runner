import { DurableService } from "../../durable/core/DurableService";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";
import {
  createTaskExecutor,
  pendingExecution,
} from "./DurableService.unit.helpers";

describe("durable: ExecutionManager lock ownership coverage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rethrows unexpected ownership recheck failures", async () => {
    const store = new MemoryStore();
    const task = { id: "t-lock-ownership-error" };
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
      tasks: [task as any],
    });

    await store.saveExecution(
      pendingExecution({ id: "e-lock-ownership-error", workflowKey: task.id }),
    );

    jest
      .spyOn(service._executionManager as any, "assertStoreLockOwnership")
      .mockRejectedValue(genericError.new({ message: "ownership-recheck" }));

    await expect(
      service.processExecution("e-lock-ownership-error"),
    ).rejects.toThrow("ownership-recheck");
  });

  it("persists sleeping state when a suspension survives ownership recheck", async () => {
    const store = new MemoryStore();
    const task = { id: "t-lock-ownership-suspend" };
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
      tasks: [task as any],
    });

    await store.saveExecution(
      pendingExecution({
        id: "e-lock-ownership-suspend",
        workflowKey: task.id,
      }),
    );

    await service.processExecution("e-lock-ownership-suspend");

    expect((await store.getExecution("e-lock-ownership-suspend"))?.status).toBe(
      "sleeping",
    );
  });

  it("creates retry timers when retry scheduling survives ownership recheck", async () => {
    const store = new MemoryStore();
    const task = { id: "t-lock-ownership-retry" };
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new Error("retry-me");
        },
      }),
      tasks: [task as any],
      execution: { maxAttempts: 2 },
    });

    await store.saveExecution(
      pendingExecution({
        id: "e-lock-ownership-retry",
        workflowKey: task.id,
        maxAttempts: 2,
      }),
    );

    await service.processExecution("e-lock-ownership-retry");

    expect((await store.getExecution("e-lock-ownership-retry"))?.status).toBe(
      "retrying",
    );
    expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual([
      expect.objectContaining({
        id: "retry:e-lock-ownership-retry:1",
        executionId: "e-lock-ownership-retry",
        type: "retry",
      }),
    ]);
  });
});
