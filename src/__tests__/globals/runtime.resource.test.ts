import { defineEvent, defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";
import { RunResult } from "../../models/RunResult";
import { ResourceLifecycleMode, RunnerMode } from "../../types/runner";

describe("system.runtime", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("works inside resource init and after boot with task/event/resource/root access", async () => {
    const double = defineTask({
      id: "runtime-double",
      run: async (input: number) => input * 2,
    });

    const acc = defineResource<{ seed: number }, Promise<{ value: number }>>({
      id: "runtime-acc",
      init: async (config) => ({ value: config.seed }),
    });

    const snapshot: {
      byDefinition?: number;
      accValue?: number;
      accConfig?: { seed: number };
      rootId?: string;
      rootConfig?: { mode: string };
    } = {};

    const probe = defineResource({
      id: "runtime-probe",
      dependencies: {
        runtime: globalResources.runtime,
        acc,
      },
      init: async (_, { runtime }) => {
        snapshot.byDefinition = await runtime.runTask(double, 21);

        snapshot.accValue = runtime.getResourceValue(acc).value;
        snapshot.accConfig = runtime.getResourceConfig(acc);
        snapshot.rootId = runtime.root.id;
        snapshot.rootConfig = runtime.getResourceConfig<{ mode: string }>(
          runtime.root,
        );

        return "probe-ready";
      },
    });

    const app = defineResource<
      { mode: string },
      Promise<string>,
      { probe: typeof probe; runtime: typeof globalResources.runtime }
    >({
      id: "runtime-app",
      register: [double, acc.with({ seed: 10 }), probe],
      dependencies: {
        probe,
        runtime: globalResources.runtime,
      },
      init: async (config, { probe, runtime }) => {
        expect(runtime.root.id).toBe("runtime-app");
        expect(
          runtime.getResourceConfig<{ mode: string }>(runtime.root),
        ).toEqual({
          mode: config.mode,
        });
        return `app-ready:${probe}:${config.mode}`;
      },
    });

    const runtimeResult = await run(app.with({ mode: "alpha" }));

    expect(snapshot).toEqual({
      byDefinition: 42,
      accValue: 10,
      accConfig: { seed: 10 },
      rootId: "runtime-app",
      rootConfig: { mode: "alpha" },
    });

    const runtime = runtimeResult.getResourceValue(globalResources.runtime);
    expect(runtime).toBe(runtimeResult);
    expect(runtime.root.id).toBe("runtime-app");
    expect(runtime.getResourceConfig<{ mode: string }>(runtime.root)).toEqual({
      mode: "alpha",
    });
    expect(runtime.getResourceValue(runtime.root)).toBe(
      "app-ready:probe-ready:alpha",
    );

    await runtimeResult.dispose();
  });

  it("throws RunResult-aligned not-found errors for missing ids", async () => {
    const app = defineResource({ id: "runtime-empty" });
    const runtimeResult = await run(app);
    const runtime = runtimeResult.getResourceValue(globalResources.runtime);

    expect(() => runtime.runTask("missing.task")).toThrow(
      'Task "missing.task" not found.',
    );
    expect(() => runtime.emitEvent("missing.event")).toThrow(
      'Event "missing.event" not found.',
    );
    expect(() => runtime.getResourceValue("missing.resource")).toThrow(
      'Resource "missing.resource" not found.',
    );
    expect(() => runtime.getResourceConfig("missing.resource")).toThrow(
      'Resource "missing.resource" not found.',
    );

    await runtimeResult.dispose();
  });

  it("fails fast for registered but uninitialized resources in lazy mode", async () => {
    const lazyInit = jest.fn(async () => ({ ready: true }));
    const lazyOnly = defineResource({
      id: "runtime-lazy-only",
      init: lazyInit,
    });

    const app = defineResource({
      id: "runtime-lazy-app",
      register: [lazyOnly],
      dependencies: { runtime: globalResources.runtime },
      init: async (_, { runtime }) => {
        expect(runtime.getResourceValue(lazyOnly)).toBeUndefined();
        return "ok";
      },
    });

    const runtimeResult = await run(app, { lazy: true, shutdownHooks: false });
    expect(lazyInit).toHaveBeenCalledTimes(0);

    const runtime = runtimeResult.getResourceValue(globalResources.runtime);
    expect(() => runtime.getResourceValue(lazyOnly)).toThrow(
      /getLazyResourceValue/,
    );

    await runtimeResult.dispose();
  });

  it("fails fast when root is not available yet", () => {
    const runtime = new RunResult<unknown>(
      {} as any,
      {
        tasks: new Map(),
        events: new Map(),
        resources: new Map(),
      } as any,
      {} as any,
      {} as any,
      {
        logs: {
          printThreshold: "info",
          printStrategy: "pretty",
          bufferLogs: false,
        },
        errorBoundary: true,
        shutdownHooks: false,
        dispose: {
          totalBudgetMs: 30_000,
          drainingBudgetMs: 20_000,
          cooldownWindowMs: 0,
        },
        onUnhandledError: async () => {},
        dryRun: false,
        executionContext: null,
        lazy: false,
        lifecycleMode: ResourceLifecycleMode.Sequential,
        mode: RunnerMode.TEST,
      },
      async () => {},
    );

    expect(() => runtime.root).toThrow("Root resource is not available.");
  });

  it("blocks dispose during bootstrap from injected runtime", async () => {
    const probe = defineResource({
      id: "runtime-dispose-probe",
      dependencies: { runtime: globalResources.runtime },
      init: async (_config, { runtime }) => {
        expect(() => runtime.dispose()).toThrow(
          "RunResult.dispose() is not available during bootstrap. Wait for run() to finish initialization.",
        );
        return "ok";
      },
    });

    const app = defineResource({
      id: "runtime-dispose-app",
      register: [probe],
      init: async () => "ready",
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });
    await runtime.dispose();
  });

  it("exposes getHealth through system.runtime", async () => {
    const monitored = defineResource({
      id: "runtime-health-monitored",
      async init() {
        return { ok: true };
      },
      async health(value) {
        return {
          status: value?.ok ? "healthy" : "unhealthy",
          message: "checked",
        };
      },
    });

    const app = defineResource({
      id: "runtime-health-app",
      register: [monitored],
      dependencies: { runtime: globalResources.runtime },
      async init() {
        return "ready";
      },
    });

    const runtimeResult = await run(app, { shutdownHooks: false });
    const runtime = runtimeResult.getResourceValue(globalResources.runtime);
    const report = await runtime.getHealth([monitored]);
    const monitoredId = runtimeResult.store.findIdByDefinition(monitored);

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.report).toEqual([
      expect.objectContaining({
        id: monitoredId,
        status: "healthy",
        initialized: true,
      }),
    ]);

    await runtimeResult.dispose();
  });

  it("blocks runtime.getHealth during bootstrap", async () => {
    const monitored = defineResource({
      id: "runtime-health-bootstrap-monitored",
      async init() {
        return { ok: true };
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const probe = defineResource({
      id: "runtime-health-bootstrap-probe",
      dependencies: { runtime: globalResources.runtime },
      async init(_config, { runtime }) {
        await expect(runtime.getHealth([monitored])).rejects.toMatchObject({
          id: "runtimeHealthDuringBootstrap",
        });
        return "ok";
      },
    });

    const app = defineResource({
      id: "runtime-health-bootstrap-app",
      register: [monitored, probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });
    await runtime.dispose();
  });

  it("exposes pause/resume state and blocks new runtime admissions while paused", async () => {
    const blocker = new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    const slowTask = defineTask({
      id: "runtime-pause-slow",
      run: async () => {
        await blocker;
        return "done";
      },
    });

    const quickTask = defineTask({
      id: "runtime-pause-quick",
      run: async () => "ok",
    });
    const quickEvent = defineEvent<void>({
      id: "runtime-pause-quick-event",
    });

    const app = defineResource({
      id: "runtime-pause-app",
      register: [slowTask, quickTask, quickEvent],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });

    expect(runtime.state).toBe("running");

    const inFlight = runtime.runTask(slowTask);
    runtime.pause("test");
    expect(runtime.state).toBe("paused");
    runtime.pause("test-again");
    expect(runtime.state).toBe("paused");

    await expect(runtime.runTask(quickTask)).rejects.toThrow(/paused/i);
    await expect(runtime.emitEvent(quickEvent)).rejects.toThrow(/paused/i);

    await inFlight;
    expect(runtime.state).toBe("paused");

    runtime.resume();
    expect(runtime.state).toBe("running");
    await expect(runtime.runTask(quickTask)).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("allows pause from a task and auto-resumes when all recoverWhen checks pass", async () => {
    jest.useFakeTimers();

    let allowA = false;
    let allowB = false;

    const pauseTask = defineTask({
      id: "runtime-recover-pause-task",
      dependencies: { runtime: globalResources.runtime },
      run: async (_input, { runtime }) => {
        runtime.pause("health");
        runtime.recoverWhen({
          id: "a",
          everyMs: 10,
          check: async () => allowA,
        });
        runtime.recoverWhen({
          id: "b",
          everyMs: 10,
          check: async () => allowB,
        });
        return runtime.state;
      },
    });

    const quickTask = defineTask({
      id: "runtime-recover-quick-task",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "runtime-recover-app",
      register: [pauseTask, quickTask],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });

    await expect(runtime.runTask(pauseTask)).resolves.toBe("paused");
    expect(runtime.state).toBe("paused");
    await expect(runtime.runTask(quickTask)).rejects.toThrow(/paused/i);

    allowA = true;
    await jest.advanceTimersByTimeAsync(10);
    expect(runtime.state).toBe("paused");

    allowB = true;
    await jest.advanceTimersByTimeAsync(10);
    expect(runtime.state).toBe("running");
    await expect(runtime.runTask(quickTask)).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("treats resume() as a manual override for the current recovery episode", async () => {
    jest.useFakeTimers();

    let checks = 0;

    const pauseTask = defineTask({
      id: "runtime-recover-manual-resume-task",
      dependencies: { runtime: globalResources.runtime },
      run: async (_input, { runtime }) => {
        runtime.pause("manual-override");
        runtime.recoverWhen({
          id: "a",
          everyMs: 10,
          check: async () => {
            checks += 1;
            return false;
          },
        });
        runtime.recoverWhen({
          id: "b",
          everyMs: 10,
          check: async () => false,
        });
      },
    });

    const quickTask = defineTask({
      id: "runtime-recover-manual-resume-quick-task",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "runtime-recover-manual-resume-app",
      register: [pauseTask, quickTask],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });

    await runtime.runTask(pauseTask);
    expect(runtime.state).toBe("paused");

    runtime.resume();
    expect(runtime.state).toBe("running");

    await jest.advanceTimersByTimeAsync(50);
    expect(checks).toBe(1);
    await expect(runtime.runTask(quickTask)).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("rejects recoverWhen while running and pause controls during bootstrap", async () => {
    const probe = defineResource({
      id: "runtime-bootstrap-admission-probe",
      dependencies: { runtime: globalResources.runtime },
      async init(_config, { runtime }) {
        expect(() => runtime.pause()).toThrow(
          "Runtime pause/resume controls are not available during bootstrap. Wait for run() to finish initialization.",
        );
        expect(() => runtime.resume()).toThrow(
          "Runtime pause/resume controls are not available during bootstrap. Wait for run() to finish initialization.",
        );
        expect(() =>
          runtime.recoverWhen({
            everyMs: 10,
            check: () => true,
          }),
        ).toThrow(
          "Runtime pause/resume controls are not available during bootstrap. Wait for run() to finish initialization.",
        );
        return "ok";
      },
    });

    const app = defineResource({
      id: "runtime-bootstrap-admission-app",
      register: [probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    expect(() =>
      runtime.recoverWhen({
        everyMs: 10,
        check: () => true,
      }),
    ).toThrow("runtime.recoverWhen() requires the runtime to be paused.");
    await runtime.dispose();
  });
});
