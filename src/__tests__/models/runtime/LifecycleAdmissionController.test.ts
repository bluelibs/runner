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
});
