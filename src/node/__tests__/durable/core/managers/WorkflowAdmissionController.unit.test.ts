import { r } from "../../../..";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../../../durable/tags/durableWorkflow.tag";
import { WorkflowAdmissionController } from "../../../../durable/core/managers/WorkflowAdmissionController";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

function workflowWith(
  concurrency?: number | { windowMs: number; max: number },
) {
  return r
    .task("workflow")
    .tags(
      concurrency === undefined
        ? []
        : [durableWorkflowTag.with({ concurrency })],
    )
    .run(async () => "ok")
    .build();
}

describe("durable: WorkflowAdmissionController", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("does not touch store locks when no admission policy is configured", async () => {
    const store = new MemoryStore();
    const acquireLock = jest.spyOn(store, "acquireLock");
    const controller = new WorkflowAdmissionController(store);

    const admission = await controller.tryAdmit({
      task: workflowWith(),
      workflowKey: "orders",
      executionLockState: createExecutionLockState(),
    });

    expect(admission.kind).toBe("admitted");
    if (admission.kind === "admitted") await admission.release();
    expect(acquireLock).not.toHaveBeenCalled();
  });

  it("holds one distributed slot per concurrent attempt and releases it", async () => {
    const store = new MemoryStore();
    const controller = new WorkflowAdmissionController(store);
    const task = workflowWith(1);

    const first = await controller.tryAdmit({
      task,
      workflowKey: "orders/process",
      executionLockState: createExecutionLockState(),
    });
    const blocked = await controller.tryAdmit({
      task,
      workflowKey: "orders/process",
      executionLockState: createExecutionLockState(),
    });

    expect(first.kind).toBe("admitted");
    expect(blocked).toEqual({ kind: "deferred", retryAfterMs: 100 });

    const otherWorkflow = await new WorkflowAdmissionController(store).tryAdmit(
      {
        task,
        workflowKey: "invoices/process",
        executionLockState: createExecutionLockState(),
      },
    );
    expect(otherWorkflow.kind).toBe("admitted");
    if (otherWorkflow.kind === "admitted") await otherWorkflow.release();
    if (first.kind === "admitted") await first.release();

    const next = await controller.tryAdmit({
      task,
      workflowKey: "orders/process",
      executionLockState: createExecutionLockState(),
    });
    expect(next.kind).toBe("admitted");
    if (next.kind === "admitted") await next.release();
  });

  it("keeps failed concurrency-slot cleanup bounded by the lease", async () => {
    const store = new MemoryStore();
    jest.spyOn(store, "releaseLock").mockRejectedValueOnce(new Error("down"));
    const controller = new WorkflowAdmissionController(store);
    const admission = await controller.tryAdmit({
      task: workflowWith(1),
      workflowKey: "orders",
      executionLockState: createExecutionLockState(),
    });

    expect(admission.kind).toBe("admitted");
    if (admission.kind === "admitted") {
      await expect(admission.release()).resolves.toBeUndefined();
    }
  });

  it("fails fast when concurrency requires unsupported store locks", async () => {
    const controller = new WorkflowAdmissionController(
      createBareStore(new MemoryStore()),
    );

    await expect(
      controller.tryAdmit({
        task: workflowWith(1),
        workflowKey: "orders",
        executionLockState: createExecutionLockState(),
      }),
    ).rejects.toThrow(
      "does not implement acquireLock(), renewLock(), and releaseLock()",
    );
  });

  it("uses fixed windows without releasing consumed rate slots", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const store = new MemoryStore();
    const releaseLock = jest.spyOn(store, "releaseLock");
    const controller = new WorkflowAdmissionController(store);
    const task = workflowWith({ windowMs: 1_000, max: 1 });

    const first = await controller.tryAdmit({
      task,
      workflowKey: "emails",
      executionLockState: createExecutionLockState(),
    });
    const blocked = await controller.tryAdmit({
      task,
      workflowKey: "emails",
      executionLockState: createExecutionLockState(),
    });

    expect(blocked).toEqual({ kind: "deferred", retryAfterMs: 750 });
    if (first.kind === "admitted") await first.release();
    expect(releaseLock).not.toHaveBeenCalled();

    jest.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    const nextWindow = await controller.tryAdmit({
      task,
      workflowKey: "emails",
      executionLockState: createExecutionLockState(),
    });
    expect(nextWindow.kind).toBe("admitted");
  });

  it("fails fast when rate limits require unsupported store locks", async () => {
    const controller = new WorkflowAdmissionController(
      createBareStore(new MemoryStore()),
    );

    await expect(
      controller.tryAdmit({
        task: workflowWith({ windowMs: 1_000, max: 1 }),
        workflowKey: "emails",
        executionLockState: createExecutionLockState(),
      }),
    ).rejects.toThrow("does not implement acquireLock()");
  });

  it("persists a retry timer for deferred attempts", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new MemoryStore();
    const controller = new WorkflowAdmissionController(store);

    await controller.defer("execution-1", 0);
    await controller.defer("execution-2", 50);

    const timers = await store.getReadyTimers(
      new Date("2026-01-01T00:00:00.050Z"),
    );
    expect(timers).toEqual([
      expect.objectContaining({ executionId: "execution-1" }),
      expect.objectContaining({ executionId: "execution-2" }),
    ]);
  });
});
