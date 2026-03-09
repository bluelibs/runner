import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "../../../models/runtime/LifecycleAdmissionController";
import { runtimeSource } from "../../../types/runtimeSource";

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
});
