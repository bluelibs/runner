import {
  defineResource,
  defineTask,
  defineEvent,
  defineHook,
} from "../../define";
import { globalResources } from "../../globals/globalResources";
import { EventEmissionFailureMode } from "../../defs";
import { TaskRunner } from "../../models";
import { run } from "../../run";
import { createTestFixture } from "../test-utils";
import { createMessageError } from "../../errors";

describe("RunResult", () => {
  it("exposes runTask, emitEvent, getResourceValue, getResourceConfig, logger and they work", async () => {
    const double = defineTask({
      id: "helpers.double",
      run: async (x: number) => x * 2,
    });

    const acc = defineResource({
      id: "helpers.acc",
      configSchema: {
        parse(input) {
          return input as { label: string };
        },
      },
      async init() {
        return { calls: 0 } as { calls: number };
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "helpers.ping" });

    const onPing = defineHook({
      id: "helpers.onPing",
      on: ping,
      dependencies: { acc },
      async run(e, deps) {
        deps.acc.calls += e.data.n;
      },
    });

    const app = defineResource({
      id: "helpers.app",
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

    const value = r.getResourceValue("helpers.acc");
    expect(value.calls).toBe(5);

    const value2 = r.getResourceValue(acc);
    expect(value2.calls).toBe(5);

    const config = r.getResourceConfig(acc);
    expect(config).toEqual({ label: "main" });

    const config2 = r.getResourceConfig("helpers.acc");
    expect(config2).toEqual({ label: "main" });

    await r.dispose();
  });

  it("supports string ids for runTask, emitEvent, getResourceValue, and getResourceConfig", async () => {
    const acc = defineResource({
      id: "rr.acc",
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
      id: "rr.inc",
      dependencies: { acc },
      async run(i, d) {
        d.acc.value += i.by;
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "rr.ping" });

    const onPing = defineHook({
      id: "rr.onPing",
      on: ping,
      dependencies: { acc },
      async run(e, d) {
        d.acc.value += e.data.n;
      },
    });

    const app = defineResource({
      id: "rr.app",
      register: [acc.with({ seed: 123 }), inc, ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app);

    await r.runTask("rr.inc", { by: 2 });
    await r.emitEvent("rr.ping", { n: 3 });
    const value = r.getResourceValue("rr.acc");
    expect(value.value).toBe(5);
    const config = r.getResourceConfig("rr.acc");
    expect(config).toEqual({ seed: 123 });

    await r.dispose();
  });

  it("emitEvent supports report mode for aggregated listener failures", async () => {
    const ping = defineEvent<{ n: number }>({ id: "rr.report.ping" });

    const failFirst = defineHook({
      id: "rr.report.failFirst",
      on: ping,
      run: async () => {
        throw createMessageError("first");
      },
    });

    const failSecond = defineHook({
      id: "rr.report.failSecond",
      on: ping,
      run: async () => {
        throw createMessageError("second");
      },
    });

    const app = defineResource({
      id: "rr.report.app",
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
    const app = defineResource({ id: "rr.empty" });
    const r = await run(app);

    expect(() => r.runTask("nope.task")).toThrow('Task "nope.task" not found.');
    expect(() => r.emitEvent("nope.event")).toThrow(
      'Event "nope.event" not found.',
    );
    expect(() => r.getResourceValue("nope.res")).toThrow(
      'Resource "nope.res" not found.',
    );
    expect(() => r.getResourceConfig("nope.res")).toThrow(
      'Resource "nope.res" not found.',
    );
    await expect(r.getLazyResourceValue("nope.res")).rejects.toThrow(
      /only available when run\(\.\.\., \{ lazy: true \}\)/,
    );

    await r.dispose();
  });

  it("supports explicit lazy resource access and blocks getResourceValue for startup-unused resources", async () => {
    const lazyInit = jest.fn(async () => ({ lazy: true }));
    const lazyOnly = defineResource({
      id: "rr.lazy.only",
      init: lazyInit,
    });

    const app = defineResource({
      id: "rr.lazy.app",
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

  it("fails fast when getLazyResourceValue is called outside lazy mode", async () => {
    const only = defineResource({
      id: "rr.lazy.dryrun.only",
      async init() {
        return "ready";
      },
    });
    const app = defineResource({
      id: "rr.lazy.dryrun.app",
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
      runtime.getLazyResourceValue("rr.lazy.missing"),
    ).rejects.toThrow('Resource "rr.lazy.missing" not found.');
  });

  it("returns stored value in lazy mode when no lazy loader is configured", async () => {
    const fixture = createTestFixture();
    const taskRunner: TaskRunner = fixture.createTaskRunner();
    fixture.store.setTaskRunner(taskRunner);
    const runtime = fixture.createRuntimeResult(taskRunner);
    runtime.setLazyOptions({ lazyMode: true });

    const resource = defineResource({
      id: "rr.lazy.manual.resource",
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

  it("exposes root helpers and blocks dispose during bootstrap", async () => {
    const probe = defineResource({
      id: "rr.root.probe",
      dependencies: { runtime: globalResources.runtime },
      init: async (_config, { runtime }) => {
        expect(runtime.getRootId()).toBe("rr.root.app");
        expect(runtime.getRootConfig<{ mode: "alpha" }>()).toEqual({
          mode: "alpha",
        });
        expect(() => runtime.getRootValue()).toThrow(
          'Root resource "rr.root.app" is not initialized yet.',
        );
        expect(() => runtime.dispose()).toThrow(
          "RunResult.dispose() is not available during bootstrap. Wait for run() to finish initialization.",
        );
        return "probe-ready";
      },
    });

    const app = defineResource<{ mode: "alpha" }, Promise<string>>({
      id: "rr.root.app",
      register: [probe],
      init: async () => "app-ready",
    });

    const runtime = await run(app.with({ mode: "alpha" }), {
      shutdownHooks: false,
    });
    expect(runtime.getRootId()).toBe("rr.root.app");
    expect(runtime.getRootConfig<{ mode: "alpha" }>()).toEqual({
      mode: "alpha",
    });
    expect(runtime.getRootValue<string>()).toBe("app-ready");

    await runtime.dispose();
  });
});
