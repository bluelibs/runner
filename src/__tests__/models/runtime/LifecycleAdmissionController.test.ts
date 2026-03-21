import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "../../../models/runtime/LifecycleAdmissionController";
import {
  RuntimeCallSourceKind,
  runtimeSource,
} from "../../../types/runtimeSource";

describe("LifecycleAdmissionController", () => {
  it("keeps disposed phase when beginDrained is called after markDisposed", () => {
    const controller = new LifecycleAdmissionController();

    controller.markDisposed();
    controller.beginDrained();

    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposed);
  });

  it("rejects admissions after drained/disposed except lifecycle bypass", () => {
    const controller = new LifecycleAdmissionController();

    controller.beginDisposing();
    controller.beginDrained();

    expect(controller.canAdmitTask(runtimeSource.task("task-a"))).toBe(false);
    expect(controller.canAdmitEvent(runtimeSource.hook("hook-a"))).toBe(false);
    expect(
      controller.canAdmitEvent(runtimeSource.runtime("runtime-lifecycle"), {
        allowLifecycleBypass: true,
      }),
    ).toBe(true);

    controller.markDisposed();

    expect(controller.canAdmitTask(runtimeSource.task("task-a"))).toBe(false);
    expect(controller.canAdmitEvent(runtimeSource.hook("hook-a"))).toBe(false);
  });

  it("switches to paused and resumes back to running", async () => {
    const controller = new LifecycleAdmissionController();
    const taskSource = runtimeSource.task("task-a");

    const inFlight = controller.trackTaskExecution(taskSource, async () => {
      controller.beginPausing();
      expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Paused);
    });

    expect(controller.canAdmitTask(runtimeSource.runtime("runtime-api"))).toBe(
      false,
    );
    expect(controller.canAdmitTask(taskSource)).toBe(true);

    await inFlight;

    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Paused);
    expect(controller.canAdmitTask(taskSource)).toBe(false);

    controller.resume();

    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Running);
    expect(controller.canAdmitTask(runtimeSource.runtime("runtime-api"))).toBe(
      true,
    );
  });

  it("keeps pause/resume idempotent when already switched", () => {
    const controller = new LifecycleAdmissionController();

    controller.beginPausing();
    controller.beginPausing();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Paused);

    controller.resume();
    controller.resume();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Running);
  });

  it("keeps admissions open during coolingDown and applies resource allowlists only once disposing starts", () => {
    const controller = new LifecycleAdmissionController();
    const runtimeCall = runtimeSource.runtime("runtime-api");
    const resourceCall = runtimeSource.resource("app.resource-a");

    controller.beginCoolingDown();

    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.CoolingDown);
    expect(controller.canAdmitTask(runtimeCall)).toBe(true);
    expect(controller.canAdmitTask(resourceCall)).toBe(true);

    controller.allowShutdownResourceSource("app.resource-a");
    controller.beginDisposing();

    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposing);
    expect(controller.canAdmitTask(runtimeCall)).toBe(false);
    expect(controller.canAdmitTask(resourceCall)).toBe(true);
  });

  it("keeps beginCoolingDown idempotent once shutdown has progressed", () => {
    const controller = new LifecycleAdmissionController();

    controller.beginCoolingDown();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.CoolingDown);

    controller.beginCoolingDown();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.CoolingDown);

    controller.beginDisposing();
    controller.beginCoolingDown();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposing);
  });

  it("keeps beginDisposing idempotent once shutdown has progressed", () => {
    const controller = new LifecycleAdmissionController();

    controller.beginDisposing();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposing);

    controller.beginDisposing();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposing);

    controller.beginDrained();
    controller.beginDisposing();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Drained);

    controller.markDisposed();
    controller.beginDisposing();
    expect(controller.getPhase()).toBe(RuntimeLifecyclePhase.Disposed);
  });

  it("admits explicitly allowed resource sources during disposing only", () => {
    const controller = new LifecycleAdmissionController();
    const allowedResource = runtimeSource.resource("app.resource-a");
    const otherResource = runtimeSource.resource("app.resource-b");

    controller.beginDisposing();

    expect(controller.canAdmitTask(allowedResource)).toBe(false);

    controller.allowShutdownResourceSource("app.resource-a");

    expect(controller.canAdmitTask(allowedResource)).toBe(true);
    expect(controller.canAdmitTask(otherResource)).toBe(false);

    controller.beginDrained();

    expect(controller.canAdmitTask(allowedResource)).toBe(false);
  });

  it("ignores shutdown resource allows outside disposing", () => {
    const controller = new LifecycleAdmissionController();
    const resourceSource = {
      kind: RuntimeCallSourceKind.Resource,
      id: "resource-no-path",
    };

    controller.beginPausing();
    controller.allowShutdownResourceSource("resource-no-path");
    expect(controller.canAdmitTask(resourceSource)).toBe(false);

    controller.resume();
    controller.beginDisposing();
    expect(controller.canAdmitTask(resourceSource)).toBe(false);

    controller.allowShutdownResourceSource("resource-no-path");
    expect(controller.canAdmitTask(resourceSource)).toBe(true);
  });

  it("returns false immediately when waitForDrain receives a non-positive timeout", async () => {
    const controller = new LifecycleAdmissionController();
    let releaseTask: (() => void) | undefined;

    const pendingTask = controller.trackTaskExecution(
      runtimeSource.task("task-pending"),
      async () =>
        new Promise<void>((resolve) => {
          releaseTask = resolve;
        }),
    );

    await expect(controller.waitForDrain(0)).resolves.toBe(false);

    releaseTask?.();
    await pendingTask;
  });

  it("cancels active drain waiters when shutdown is force-escalated", async () => {
    const controller = new LifecycleAdmissionController();
    let releaseTask: (() => void) | undefined;

    const pendingTask = controller.trackTaskExecution(
      runtimeSource.task("task-force-cancel"),
      async () =>
        new Promise<void>((resolve) => {
          releaseTask = resolve;
        }),
    );

    const waitForDrainPromise = controller.waitForDrain(1_000);

    controller.cancelDrainWaiters();

    await expect(waitForDrainPromise).resolves.toBe(false);

    releaseTask?.();
    await pendingTask;
  });

  it("reference-counts tracked task abort controllers", () => {
    const controller = new LifecycleAdmissionController();
    const abortController = new AbortController();
    const alreadyAbortedController = new AbortController();
    alreadyAbortedController.abort("already done");

    const releaseA = controller.trackTaskAbortController(abortController);
    const releaseB = controller.trackTaskAbortController(abortController);
    const releaseC = controller.trackTaskAbortController(
      alreadyAbortedController,
    );

    releaseA();
    expect(abortController.signal.aborted).toBe(false);

    controller.abortInFlightTaskSignals("shutdown");
    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe("shutdown");
    expect(alreadyAbortedController.signal.reason).toBe("already done");

    releaseB();
    releaseC();
    expect(() => releaseB()).not.toThrow();
  });
});
