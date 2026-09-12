import { defineResource } from "../../define";
import { run } from "../../run";
import type { IRuntime } from "../../types/runner";
import type { IInspectableRuntime } from "../../types/runtimeInspection";

type RuntimeContractHasInspect = "inspect" extends keyof IRuntime
  ? true
  : false;
type InspectableExtendsRuntime = IInspectableRuntime extends IRuntime
  ? true
  : false;

describe("RuntimeInspector lifecycle", () => {
  it("keeps inspection additive to IRuntime", () => {
    const runtimeContractHasInspect: RuntimeContractHasInspect = false;
    const inspectableExtendsRuntime: InspectableExtendsRuntime = true;

    expect(runtimeContractHasInspect).toBe(false);
    expect(inspectableExtendsRuntime).toBe(true);
  });

  it("reports ready/shutdown waves and retains the locked snapshot", async () => {
    const left = defineResource({
      id: "left",
      init: async () => "left",
    });
    const right = defineResource({
      id: "right",
      init: async () => "right",
    });
    const app = defineResource({
      id: "app",
      register: [left, right],
      dependencies: { left, right },
      init: async () => "app",
    });
    const runtime = await run(app, {
      lifecycleMode: "parallel",
      shutdownHooks: false,
    });

    const snapshot = runtime.inspect().snapshot();
    const parallelReadyWave = snapshot.lifecycle.readyWaves.find(
      ({ resourceIds }) =>
        resourceIds.includes("app.left") && resourceIds.includes("app.right"),
    );
    const parallelShutdownWave = snapshot.lifecycle.shutdownWaves.find(
      ({ resourceIds }) =>
        resourceIds.includes("app.left") && resourceIds.includes("app.right"),
    );

    expect(parallelReadyWave).toMatchObject({ parallel: true });
    expect(parallelShutdownWave).toMatchObject({ parallel: true });
    expect(snapshot.lifecycle.readyWaves.map(({ order }) => order)).toEqual(
      snapshot.lifecycle.readyWaves.map((_, order) => order),
    );
    expect(snapshot.lifecycle.shutdownWaves.map(({ order }) => order)).toEqual(
      snapshot.lifecycle.shutdownWaves.map((_, order) => order),
    );
    expect(Object.isFrozen(snapshot.lifecycle.readyWaves)).toBe(true);
    expect(runtime.inspect().snapshot()).toBe(snapshot);

    await runtime.dispose();

    expect(runtime.inspect().snapshot()).toBe(snapshot);
    expect(snapshot.lifecycle.readyWaves.length).toBeGreaterThan(0);
  });
});
