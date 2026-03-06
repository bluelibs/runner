import { defineResource } from "../../define";
import { run } from "../../run";
import { ResourceInitMode, ResourceLifecycleMode } from "../../types/runner";
import { createMessageError } from "../../errors";

describe("run parallel disposal lifecycle", () => {
  it("runs cooldown in reverse waves and same-wave parallel before disposal", async () => {
    let releaseCooldownWave!: () => void;
    const cooldownWaveGate = new Promise<void>((resolve) => {
      releaseCooldownWave = resolve;
    });

    let releaseParallelWave!: () => void;
    const parallelWaveGate = new Promise<void>((resolve) => {
      releaseParallelWave = resolve;
    });

    const callOrder: string[] = [];
    let activeCooldowns = 0;
    let maxConcurrentCooldowns = 0;
    let activeDisposals = 0;
    let maxConcurrentDisposals = 0;

    const sharedDepA = defineResource({
      id: "parallel-dispose-wave-a",
      async init() {
        return "a";
      },
      async cooldown() {
        callOrder.push("a:cooldown:start");
        activeCooldowns += 1;
        maxConcurrentCooldowns = Math.max(
          maxConcurrentCooldowns,
          activeCooldowns,
        );
        await cooldownWaveGate;
        activeCooldowns -= 1;
        callOrder.push("a:cooldown:end");
      },
      async dispose() {
        callOrder.push("a:dispose:start");
        activeDisposals += 1;
        maxConcurrentDisposals = Math.max(
          maxConcurrentDisposals,
          activeDisposals,
        );
        await parallelWaveGate;
        activeDisposals -= 1;
        callOrder.push("a:dispose:end");
      },
    });

    const sharedDepB = defineResource({
      id: "parallel-dispose-wave-b",
      async init() {
        return "b";
      },
      async cooldown() {
        callOrder.push("b:cooldown:start");
        activeCooldowns += 1;
        maxConcurrentCooldowns = Math.max(
          maxConcurrentCooldowns,
          activeCooldowns,
        );
        await cooldownWaveGate;
        activeCooldowns -= 1;
        callOrder.push("b:cooldown:end");
      },
      async dispose() {
        callOrder.push("b:dispose:start");
        activeDisposals += 1;
        maxConcurrentDisposals = Math.max(
          maxConcurrentDisposals,
          activeDisposals,
        );
        await parallelWaveGate;
        activeDisposals -= 1;
        callOrder.push("b:dispose:end");
      },
    });

    const upperWave = defineResource({
      id: "parallel-dispose-wave-upper",
      dependencies: { sharedDepA, sharedDepB },
      async init() {
        return "upper";
      },
      async cooldown() {
        callOrder.push("upper:cooldown");
      },
      async dispose() {
        callOrder.push("upper:dispose");
      },
    });

    const app = defineResource({
      id: "parallel-dispose-wave-app",
      register: [sharedDepA, sharedDepB, upperWave],
      dependencies: { upperWave },
      async init() {
        return "app";
      },
    });

    const runtime = await run(app, {
      lifecycleMode: ResourceLifecycleMode.Parallel,
      shutdownHooks: false,
    });

    const disposePromise = runtime.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOrder[0]).toBe("upper:cooldown");
    expect(callOrder).toEqual(
      expect.arrayContaining(["a:cooldown:start", "b:cooldown:start"]),
    );
    expect(maxConcurrentCooldowns).toBe(2);
    expect(callOrder).not.toContain("upper:dispose");

    releaseCooldownWave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOrder).toContain("upper:dispose");
    expect(callOrder).toEqual(
      expect.arrayContaining(["a:dispose:start", "b:dispose:start"]),
    );
    expect(maxConcurrentDisposals).toBe(2);

    releaseParallelWave();
    await disposePromise;
  });

  it("continues same-wave disposal when one disposer fails", async () => {
    const calls: string[] = [];

    const sharedDepA = defineResource({
      id: "parallel-dispose-failure-a",
      async init() {
        return "a";
      },
      async dispose() {
        calls.push("a");
        throw createMessageError("a dispose failed");
      },
    });

    const sharedDepB = defineResource({
      id: "parallel-dispose-failure-b",
      async init() {
        return "b";
      },
      async dispose() {
        calls.push("b");
      },
    });

    const upperWave = defineResource({
      id: "parallel-dispose-failure-upper",
      dependencies: { sharedDepA, sharedDepB },
      async init() {
        return "upper";
      },
      async dispose() {
        calls.push("upper");
      },
    });

    const app = defineResource({
      id: "parallel-dispose-failure-app",
      register: [sharedDepA, sharedDepB, upperWave],
      dependencies: { upperWave },
      async init() {
        return "app";
      },
    });

    const runtime = await run(app, {
      lifecycleMode: ResourceLifecycleMode.Parallel,
      shutdownHooks: false,
    });

    await expect(runtime.dispose()).rejects.toThrow("a dispose failed");
    expect(calls).toEqual(expect.arrayContaining(["upper", "a", "b"]));
  });

  it("keeps reverse sequential disposal when lifecycleMode is sequential", async () => {
    const calls: string[] = [];

    const first = defineResource({
      id: "parallel-dispose-sequential-first",
      async init() {
        return "first";
      },
      async cooldown() {
        calls.push("first:cooldown");
      },
      async dispose() {
        calls.push("first:dispose");
      },
    });

    const second = defineResource({
      id: "parallel-dispose-sequential-second",
      async init() {
        return "second";
      },
      async cooldown() {
        calls.push("second:cooldown");
      },
      async dispose() {
        calls.push("second:dispose");
      },
    });

    const app = defineResource({
      id: "parallel-dispose-sequential-app",
      register: [first, second],
      async init() {
        return "app";
      },
    });

    const runtime = await run(app, {
      lifecycleMode: ResourceLifecycleMode.Sequential,
      shutdownHooks: false,
    });

    await runtime.dispose();
    expect(calls).toEqual([
      "second:cooldown",
      "first:cooldown",
      "second:dispose",
      "first:dispose",
    ]);
  });

  it("supports deprecated initMode alias for lifecycle scheduling", async () => {
    let releaseParallelInits!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseParallelInits = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    const first = defineResource({
      id: "parallel-dispose-alias-first",
      async init() {
        firstStarted = true;
        await gate;
        return "first";
      },
    });

    const second = defineResource({
      id: "parallel-dispose-alias-second",
      async init() {
        secondStarted = true;
        await gate;
        return "second";
      },
    });

    const app = defineResource({
      id: "parallel-dispose-alias-app",
      register: [first, second],
      async init() {
        return "app";
      },
    });

    const runtimePromise = run(app, {
      initMode: ResourceInitMode.Parallel,
      shutdownHooks: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(true);

    releaseParallelInits();
    const runtime = await runtimePromise;
    await runtime.dispose();
  });
});
