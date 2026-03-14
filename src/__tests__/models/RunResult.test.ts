import {
  defineResource,
  defineTask,
  defineEvent,
  defineHook,
} from "../../define";
import { journal } from "../..";
import { globalResources } from "../../globals/globalResources";
import { EventEmissionFailureMode } from "../../defs";
import { TaskRunner } from "../../models";
import { run } from "../../run";
import { createTestFixture } from "../test-utils";
import { createMessageError } from "../../errors";
import { runtimeSource } from "../../types/runtimeSource";
import { ResourceLifecycleMode, RunnerMode } from "../../types/runner";

describe("RunResult", () => {
  it("exposes runTask, emitEvent, getResourceValue, getResourceConfig, logger and they work", async () => {
    const double = defineTask({
      id: "helpers-double",
      run: async (x: number) => x * 2,
    });

    const acc = defineResource({
      id: "helpers-acc",
      configSchema: {
        parse(input) {
          return input as { label: string };
        },
      },
      async init() {
        return { calls: 0 } as { calls: number };
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "helpers-ping" });

    const onPing = defineHook({
      id: "helpers-onPing",
      on: ping,
      dependencies: { acc },
      async run(e, deps) {
        deps.acc.calls += e.data.n;
      },
    });

    const app = defineResource({
      id: "helpers-app",
      register: [double, acc.with({ label: "main" }), ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app);
    expect(typeof r.runTask).toBe("function");
    expect(typeof r.emitEvent).toBe("function");
    expect(typeof r.getResourceValue).toBe("function");
    expect(typeof r.getLazyResourceValue).toBe("function");
    expect(typeof r.getResourceConfig).toBe("function");
    expect(r.logger).toBeDefined();

    const out = await r.runTask(double, 21);
    expect(out).toBe(42);

    await r.emitEvent(ping, { n: 2 });
    await r.emitEvent(ping, { n: 3 });

    const value = r.getResourceValue("helpers-acc");
    expect(value.calls).toBe(5);

    const value2 = r.getResourceValue(acc);
    expect(value2.calls).toBe(5);

    const config = r.getResourceConfig(acc);
    expect(config).toEqual({ label: "main" });

    const config2 = r.getResourceConfig("helpers-acc");
    expect(config2).toEqual({ label: "main" });

    await r.dispose();
  });

  it("supports string ids for runTask, emitEvent, getResourceValue, and getResourceConfig", async () => {
    const acc = defineResource({
      id: "rr-acc",
      configSchema: {
        parse(input) {
          return input as { seed: number };
        },
      },
      async init() {
        return { value: 0 } as { value: number };
      },
    });

    const inc = defineTask<{ by: number }, Promise<void>>({
      id: "rr-inc",
      dependencies: { acc },
      async run(i, d) {
        d.acc.value += i.by;
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "rr-ping" });

    const onPing = defineHook({
      id: "rr-onPing",
      on: ping,
      dependencies: { acc },
      async run(e, d) {
        d.acc.value += e.data.n;
      },
    });

    const app = defineResource({
      id: "rr-app",
      register: [acc.with({ seed: 123 }), inc, ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app);

    await r.runTask("rr-inc", { by: 2 });
    await r.emitEvent("rr-ping", { n: 3 });
    const value = r.getResourceValue("rr-acc");
    expect(value.value).toBe(5);
    const config = r.getResourceConfig("rr-acc");
    expect(config).toEqual({ seed: 123 });

    await r.dispose();
  });

  it("supports runTask call-options via input/options arguments", async () => {
    const seenJournals: unknown[] = [];
    const seenSources: unknown[] = [];

    const noInputTask = defineTask<void, Promise<string>>({
      id: "rr-options-noInputTask",
      run: async (_input, _deps, context) => {
        seenJournals.push(context?.journal);
        seenSources.push(context?.source);
        return "ok";
      },
    });

    const app = defineResource({
      id: "rr-options-app",
      register: [noInputTask],
      dependencies: { noInputTask },
      init: async () => "ready",
    });

    const runtime = await run(app);
    const twoArgOptionsJournal = journal.create();
    await runtime.runTask(noInputTask, undefined, {
      journal: twoArgOptionsJournal,
    });

    expect(seenJournals[0]).toBe(twoArgOptionsJournal);
    expect(seenSources[0]).toEqual(runtimeSource.runtime("runtime.api"));
    await runtime.dispose();
  });

  it("passes task-dependency source into nested task run context", async () => {
    const seenChildSources: unknown[] = [];

    const child = defineTask<void, Promise<string>>({
      id: "rr-source-child",
      run: async (_input, _deps, context) => {
        seenChildSources.push(context?.source);
        return "child";
      },
    });

    const parent = defineTask<void, Promise<string>>({
      id: "rr-source-parent",
      dependencies: { runChild: child },
      run: async (_input, { runChild }) => runChild(),
    });

    const app = defineResource({
      id: "rr-source-app",
      register: [parent, child],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app);
    await runtime.runTask(parent);

    const parentTaskId = runtime.store.findIdByDefinition(parent);
    expect(seenChildSources[0]).toEqual(runtimeSource.task(parentTaskId));
    await runtime.dispose();
  });

  it("emitEvent supports report mode for aggregated listener failures", async () => {
    const ping = defineEvent<{ n: number }>({ id: "rr-report-ping" });

    const failFirst = defineHook({
      id: "rr-report-failFirst",
      on: ping,
      run: async () => {
        throw createMessageError("first");
      },
    });

    const failSecond = defineHook({
      id: "rr-report-failSecond",
      on: ping,
      run: async () => {
        throw createMessageError("second");
      },
    });

    const app = defineResource({
      id: "rr-report-app",
      register: [ping, failFirst, failSecond],
      async init() {
        return "ok" as const;
      },
    });

    const runtime = await run(app);
    const report = await runtime.emitEvent(
      ping,
      { n: 1 },
      {
        report: true,
        throwOnError: false,
        failureMode: EventEmissionFailureMode.Aggregate,
      },
    );

    expect(report.failedListeners).toBe(2);
    expect(report.errors).toHaveLength(2);
    await runtime.dispose();
  });

  it("throws helpful errors for missing string ids", async () => {
    const app = defineResource({ id: "rr-empty" });
    const r = await run(app);

    expect(() => r.runTask("nope-task")).toThrow('Task "nope-task" not found.');
    expect(() => r.emitEvent("nope-event")).toThrow(
      'Event "nope-event" not found.',
    );
    expect(() => r.getResourceValue("nope-res")).toThrow(
      'Resource "nope-res" not found.',
    );
    expect(() => r.getResourceConfig("nope-res")).toThrow(
      'Resource "nope-res" not found.',
    );
    await expect(r.getLazyResourceValue("nope-res")).rejects.toThrow(
      /only available when run\(\.\.\., \{ lazy: true \}\)/,
    );

    await r.dispose();
  });

  it("getHealth aggregates async health-enabled resources only", async () => {
    const healthy = defineResource({
      id: "rr-health-healthy",
      async init() {
        return "healthy-value";
      },
      async health(value) {
        return { status: "healthy", message: String(value) };
      },
    });

    const degraded = defineResource({
      id: "rr-health-degraded",
      async init() {
        return "degraded-value";
      },
      async health() {
        return { status: "degraded", message: "slow" };
      },
    });

    const unhealthy = defineResource({
      id: "rr-health-unhealthy",
      async init() {
        return "unhealthy-value";
      },
      async health() {
        throw createMessageError("down");
      },
    });

    const ignored = defineResource({
      id: "rr-health-ignored",
      async init() {
        return "ignored";
      },
    });

    const app = defineResource({
      id: "rr-health-app",
      register: [healthy, degraded, unhealthy, ignored],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const report = await runtime.getHealth();
    const healthyId = runtime.store.findIdByDefinition(healthy);
    const degradedId = runtime.store.findIdByDefinition(degraded);
    const unhealthyId = runtime.store.findIdByDefinition(unhealthy);

    expect(report.totals).toEqual({
      resources: 3,
      healthy: 1,
      degraded: 1,
      unhealthy: 1,
    });
    expect(report.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: healthyId,
          initialized: true,
          status: "healthy",
          message: "healthy-value",
        }),
        expect.objectContaining({
          id: degradedId,
          initialized: true,
          status: "degraded",
          message: "slow",
        }),
        expect.objectContaining({
          id: unhealthyId,
          initialized: true,
          status: "unhealthy",
          message: "down",
        }),
      ]),
    );
    expect(report.find(healthy)?.status).toBe("healthy");
    expect(report.find(degradedId)?.status).toBe("degraded");
    expect(() => report.find("rr-health-missing")).toThrow(
      'Health report entry for resource "rr-health-missing" was not found.',
    );

    await runtime.dispose();
  });

  it("getHealth supports filtered resource queries and excludes requested resources without health", async () => {
    const healthy = defineResource({
      id: "rr-health-filter-healthy",
      async init() {
        return "ok";
      },
      async health() {
        return { status: "healthy" };
      },
    });

    const noHealth = defineResource({
      id: "rr-health-filter-none",
      async init() {
        return "skip";
      },
    });

    const app = defineResource({
      id: "rr-health-filter-app",
      register: [healthy, noHealth],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const healthyId = runtime.store.findIdByDefinition(healthy);
    const healthyReportId = healthyId;

    await expect(
      runtime.getHealth(["rr-health-filter-missing"]),
    ).rejects.toThrow('Resource "rr-health-filter-missing" not found.');

    const filtered = await runtime.getHealth([healthyId, noHealth]);
    expect(filtered.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(filtered.report).toEqual([
      expect.objectContaining({
        id: healthyReportId,
        status: "healthy",
      }),
    ]);

    const skipped = await runtime.getHealth([noHealth]);
    expect(skipped.totals).toEqual({
      resources: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
    });
    expect(skipped.report).toEqual([]);
    expect(() => skipped.find(noHealth)).toThrow(
      'Health report entry for resource "rr-health-filter-app.rr-health-filter-none" was not found.',
    );

    await runtime.dispose();
  });

  it("getHealth de-duplicates repeated filtered resources", async () => {
    const healthy = defineResource({
      id: "rr-health-dedupe-resource",
      async init() {
        return "ok";
      },
      async health() {
        return { status: "healthy" };
      },
    });

    const app = defineResource({
      id: "rr-health-dedupe-app",
      register: [healthy],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const report = await runtime.getHealth([healthy, healthy, healthy.id]);

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.report).toHaveLength(1);

    await runtime.dispose();
  });

  it("getHealth normalizes non-Error health throws into unhealthy entries", async () => {
    const unhealthy = defineResource({
      id: "rr-health-nonerror-resource",
      async init() {
        return "ok";
      },
      async health() {
        throw "plain-string-error";
      },
    });

    const app = defineResource({
      id: "rr-health-nonerror-app",
      register: [unhealthy],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const report = await runtime.getHealth([unhealthy]);
    const unhealthyId = runtime.store.findIdByDefinition(unhealthy);

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 0,
      degraded: 0,
      unhealthy: 1,
    });
    expect(report.report).toEqual([
      expect.objectContaining({
        id: unhealthyId,
        status: "unhealthy",
        message: "plain-string-error",
        details: expect.any(Error),
      }),
    ]);

    await runtime.dispose();
  });

  it("getHealth falls back to raw object ids when definition resolution is unavailable", async () => {
    const app = defineResource({
      id: "rr-health-raw-object-app",
      async init() {
        return "ready";
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const report = await runtime.getHealth([
      { id: "rr-health-raw-object-app" } as any,
    ]);

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.report).toEqual([
      expect.objectContaining({
        id: "rr-health-raw-object-app",
        status: "healthy",
      }),
    ]);

    await runtime.dispose();
  });

  it("getHealth falls back to raw runtime path strings when alias resolution is unavailable", async () => {
    const healthy = defineResource({
      id: "rr-health-raw-string-resource",
      async init() {
        return "ok";
      },
      async health() {
        return { status: "healthy" as const };
      },
    });

    const app = defineResource({
      id: "rr-health-raw-string-app",
      register: [healthy],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const resourcePath = runtime.store.findIdByDefinition(healthy);
    const report = await runtime.getHealth([resourcePath]);

    expect(report.totals).toEqual({
      resources: 1,
      healthy: 1,
      degraded: 0,
      unhealthy: 0,
    });
    expect(report.report).toEqual([
      expect.objectContaining({
        id: resourcePath,
        status: "healthy",
      }),
    ]);

    await runtime.dispose();
  });

  it("supports explicit lazy resource access and blocks getResourceValue for startup-unused resources", async () => {
    const lazyInit = jest.fn(async () => ({ lazy: true }));
    const lazyOnly = defineResource({
      id: "rr-lazy-only",
      init: lazyInit,
    });

    const app = defineResource({
      id: "rr-lazy-app",
      register: [lazyOnly],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { lazy: true, shutdownHooks: false });
    expect(lazyInit).toHaveBeenCalledTimes(0);

    expect(() => runtime.getResourceValue(lazyOnly)).toThrow(
      /getLazyResourceValue/,
    );

    const lazyValue = await runtime.getLazyResourceValue(lazyOnly);
    expect(lazyValue).toEqual({ lazy: true });
    expect(lazyInit).toHaveBeenCalledTimes(1);

    // strict lazy mode policy: direct sync access remains blocked for startup-unused resources
    expect(() => runtime.getResourceValue(lazyOnly)).toThrow(
      /getLazyResourceValue/,
    );

    await runtime.dispose();
  });

  it("rejects lazy resource wakeups once shutdown has started", async () => {
    const fixture = createTestFixture();
    const taskRunner: TaskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);

    const resource = defineResource({
      id: "rr-lazy-shutdown-only",
    });
    fixture.store.storeGenericItem(resource);
    runtime.setLazyOptions({ lazyMode: true });
    runtime.setValue("ready");
    fixture.store.beginCoolingDown();

    await expect(runtime.getLazyResourceValue(resource)).rejects.toThrow(
      /cannot be lazy-initialized because shutdown has already started/i,
    );
  });

  it("fails fast when getLazyResourceValue is called outside lazy mode", async () => {
    const only = defineResource({
      id: "rr-lazy-dryrun-only",
      async init() {
        return "ready";
      },
    });
    const app = defineResource({
      id: "rr-lazy-dryrun-app",
      register: [only],
      async init() {
        return "app";
      },
    });

    const runtime = await run(app, { dryRun: true, shutdownHooks: false });
    await expect(runtime.getLazyResourceValue(only)).rejects.toThrow(
      /only available when run\(\.\.\., \{ lazy: true \}\)/,
    );
    await runtime.dispose();
  });

  it("throws not-found for lazy resource access in lazy mode", async () => {
    const fixture = createTestFixture();
    const taskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);
    runtime.setLazyOptions({ lazyMode: true });

    await expect(
      runtime.getLazyResourceValue("rr-lazy-missing"),
    ).rejects.toThrow('Resource "rr-lazy-missing" not found.');
  });

  it("returns stored value in lazy mode when no lazy loader is configured", async () => {
    const fixture = createTestFixture();
    const taskRunner: TaskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);
    runtime.setLazyOptions({ lazyMode: true });

    const resource = defineResource({
      id: "rr-lazy-manual-resource",
    });
    fixture.store.storeGenericItem(resource);
    const resourceEntry = fixture.store.resources.get(resource.id);
    if (!resourceEntry) {
      throw createMessageError("Expected resource entry to exist");
    }
    resourceEntry.value = { ok: true };

    await expect(runtime.getLazyResourceValue(resource)).resolves.toEqual({
      ok: true,
    });
  });

  it("exposes the root definition and blocks dispose during bootstrap", async () => {
    const probe = defineResource({
      id: "rr-root-probe",
      dependencies: { runtime: globalResources.runtime },
      init: async (_config, { runtime }) => {
        expect(runtime.root.id).toBe("rr-root-app");
        expect(
          runtime.getResourceConfig<{ mode: "alpha" }>(runtime.root),
        ).toEqual({
          mode: "alpha",
        });
        expect(() => runtime.dispose()).toThrow(
          "RunResult.dispose() is not available during bootstrap. Wait for run() to finish initialization.",
        );
        return "probe-ready";
      },
    });

    const app = defineResource<{ mode: "alpha" }, Promise<string>>({
      id: "rr-root-app",
      register: [probe],
      init: async () => "app-ready",
    });

    const runtime = await run(app.with({ mode: "alpha" }), {
      shutdownHooks: false,
    });
    expect(runtime.root.id).toBe("rr-root-app");
    expect(runtime.getResourceConfig<{ mode: "alpha" }>(runtime.root)).toEqual({
      mode: "alpha",
    });
    expect(runtime.getResourceValue(runtime.root)).toBe("app-ready");

    await runtime.dispose();
  });

  it("exposes normalized runOptions on the runtime", async () => {
    const onUnhandledError = jest.fn();
    const app = defineResource({
      id: "rr-run-options-app",
      init: async () => "ready",
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      logs: {
        printThreshold: "debug",
        printStrategy: "json",
        bufferLogs: true,
      },
      errorBoundary: false,
      dispose: {
        totalBudgetMs: 1234,
        drainingBudgetMs: 567,
        cooldownWindowMs: 89,
      },
      onUnhandledError,
      dryRun: true,
      lazy: true,
      lifecycleMode: ResourceLifecycleMode.Parallel,
      executionContext: {
        cycleDetection: { maxDepth: 10, maxRepetitions: 2 },
      },
      mode: RunnerMode.PROD,
    });

    expect(runtime.runOptions).toEqual({
      debug: undefined,
      logs: {
        printThreshold: "debug",
        printStrategy: "json",
        bufferLogs: true,
      },
      errorBoundary: false,
      shutdownHooks: false,
      dispose: {
        totalBudgetMs: 1234,
        drainingBudgetMs: 567,
        cooldownWindowMs: 89,
      },
      onUnhandledError,
      dryRun: true,
      executionContext: {
        createCorrelationId: expect.any(Function),
        cycleDetection: {
          maxDepth: 10,
          maxRepetitions: 2,
        },
      },
      lazy: true,
      lifecycleMode: ResourceLifecycleMode.Parallel,
      mode: RunnerMode.PROD,
    });
    expect(runtime.mode).toBe(RunnerMode.PROD);
    expect(runtime.store.mode).toBe(RunnerMode.PROD);

    await runtime.dispose();
  });
});
