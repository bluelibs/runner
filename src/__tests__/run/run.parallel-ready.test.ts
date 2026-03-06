import { defineResource } from "../../define";
import { run } from "../../run";
import { ResourceLifecycleMode } from "../../types/runner";

describe("run parallel ready lifecycle", () => {
  it("runs ready in dependency-order waves and same-wave parallel at startup", async () => {
    let releaseReadyWave!: () => void;
    const readyWaveGate = new Promise<void>((resolve) => {
      releaseReadyWave = resolve;
    });

    const callOrder: string[] = [];
    let activeReadyCount = 0;
    let maxConcurrentReadyCount = 0;

    const sharedDepA = defineResource({
      id: "parallel.ready.wave.a",
      async init() {
        return "a";
      },
      async ready() {
        callOrder.push("a:ready:start");
        activeReadyCount += 1;
        maxConcurrentReadyCount = Math.max(
          maxConcurrentReadyCount,
          activeReadyCount,
        );
        await readyWaveGate;
        activeReadyCount -= 1;
        callOrder.push("a:ready:end");
      },
    });

    const sharedDepB = defineResource({
      id: "parallel.ready.wave.b",
      async init() {
        return "b";
      },
      async ready() {
        callOrder.push("b:ready:start");
        activeReadyCount += 1;
        maxConcurrentReadyCount = Math.max(
          maxConcurrentReadyCount,
          activeReadyCount,
        );
        await readyWaveGate;
        activeReadyCount -= 1;
        callOrder.push("b:ready:end");
      },
    });

    const dependent = defineResource({
      id: "parallel.ready.wave.dependent",
      dependencies: { sharedDepA, sharedDepB },
      async init() {
        return "dependent";
      },
      async ready() {
        callOrder.push("dependent:ready");
      },
    });

    const app = defineResource({
      id: "parallel.ready.wave.app",
      register: [sharedDepA, sharedDepB, dependent],
      dependencies: { dependent },
      async init() {
        return "app";
      },
      async ready() {
        callOrder.push("app:ready");
      },
    });

    const runtimePromise = run(app, {
      lifecycleMode: ResourceLifecycleMode.Parallel,
      shutdownHooks: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callOrder).toEqual(
      expect.arrayContaining(["a:ready:start", "b:ready:start"]),
    );
    expect(callOrder).not.toContain("dependent:ready");
    expect(callOrder).not.toContain("app:ready");
    expect(maxConcurrentReadyCount).toBe(2);

    releaseReadyWave();
    const runtime = await runtimePromise;

    expect(callOrder).toEqual(
      expect.arrayContaining(["dependent:ready", "app:ready"]),
    );
    expect(callOrder.indexOf("dependent:ready")).toBeGreaterThan(
      callOrder.indexOf("a:ready:end"),
    );
    expect(callOrder.indexOf("dependent:ready")).toBeGreaterThan(
      callOrder.indexOf("b:ready:end"),
    );
    expect(callOrder.indexOf("app:ready")).toBeGreaterThan(
      callOrder.indexOf("dependent:ready"),
    );

    await runtime.dispose();
  });
});
