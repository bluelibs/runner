import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";
import { globalResources } from "../../globals/globalResources";
import type { RuntimeServices } from "../../globals/types";
import { createRuntimeServices } from "../../globals/resources/runtime.resource";

describe("globals.resources.runtime", () => {
  it("works inside resource init and after boot with task/event/resource/root helpers", async () => {
    const double = defineTask({
      id: "runtime.double",
      run: async (input: number) => input * 2,
    });

    const ping = defineEvent<{ n: number }>({ id: "runtime.ping" });

    const acc = defineResource<{ seed: number }, Promise<{ value: number }>>({
      id: "runtime.acc",
      init: async (config) => ({ value: config.seed }),
    });

    const onPing = defineHook({
      id: "runtime.onPing",
      on: ping,
      dependencies: { acc },
      run: async (event, deps) => {
        deps.acc.value += event.data.n;
      },
    });

    const snapshot: {
      byDefinition?: number;
      byId?: number;
      accValue?: number;
      accConfig?: { seed: number };
      rootId?: string;
      rootConfig?: { mode: string };
    } = {};

    const probe = defineResource({
      id: "runtime.probe",
      dependencies: {
        runtime: globalResources.runtime,
        acc,
      },
      init: async (_, { runtime }) => {
        snapshot.byDefinition = await runtime.runTask(double, 21);
        snapshot.byId = await runtime.runTask("runtime.double", 2);

        await runtime.emitEvent(ping, { n: 2 });
        await runtime.emitEvent("runtime.ping", { n: 3 });

        snapshot.accValue = runtime.getResourceValue(acc).value;
        snapshot.accConfig = runtime.getResourceConfig(acc);
        snapshot.rootId = runtime.getRootId();
        snapshot.rootConfig = runtime.getRootConfig<{ mode: string }>();

        expect(() => runtime.getRootValue()).toThrow(
          'Root resource "runtime.app" is not initialized yet.',
        );

        return "probe-ready";
      },
    });

    const app = defineResource<
      { mode: string },
      Promise<string>,
      { probe: typeof probe; runtime: typeof globalResources.runtime }
    >({
      id: "runtime.app",
      register: [double, ping, onPing, acc.with({ seed: 10 }), probe],
      dependencies: {
        probe,
        runtime: globalResources.runtime,
      },
      init: async (config, { probe, runtime }) => {
        expect(runtime.getRootId()).toBe("runtime.app");
        expect(runtime.getRootConfig<{ mode: string }>()).toEqual({
          mode: config.mode,
        });
        return `app-ready:${probe}:${config.mode}`;
      },
    });

    const runtimeResult = await run(app.with({ mode: "alpha" }));

    expect(snapshot).toEqual({
      byDefinition: 42,
      byId: 4,
      accValue: 15,
      accConfig: { seed: 10 },
      rootId: "runtime.app",
      rootConfig: { mode: "alpha" },
    });

    const runtime = runtimeResult.getResourceValue(
      globalResources.runtime,
    ) as RuntimeServices;
    expect(runtime.getRootId()).toBe("runtime.app");
    expect(runtime.getRootConfig<{ mode: string }>()).toEqual({
      mode: "alpha",
    });
    expect(runtime.getRootValue<string>()).toBe("app-ready:probe-ready:alpha");

    await runtimeResult.dispose();
  });

  it("throws RunResult-aligned not-found errors for missing ids", async () => {
    const app = defineResource({ id: "runtime.empty" });
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
      id: "runtime.lazy.only",
      init: lazyInit,
    });

    const app = defineResource({
      id: "runtime.lazy.app",
      register: [lazyOnly],
      dependencies: { runtime: globalResources.runtime },
      init: async (_, { runtime }) => {
        expect(() => runtime.getResourceValue(lazyOnly)).toThrow(
          'Resource "runtime.lazy.only" is not initialized yet.',
        );
        return "ok";
      },
    });

    const runtimeResult = await run(app, { lazy: true, shutdownHooks: false });
    expect(lazyInit).toHaveBeenCalledTimes(0);

    const runtime = runtimeResult.getResourceValue(globalResources.runtime);
    expect(() => runtime.getResourceValue(lazyOnly)).toThrow(
      'Resource "runtime.lazy.only" is not initialized yet.',
    );

    await runtimeResult.dispose();
  });

  it("fails fast when root is not available yet", () => {
    const runtime = createRuntimeServices({
      store: {
        tasks: new Map(),
        events: new Map(),
        resources: new Map(),
      } as any,
      eventManager: {} as any,
      taskRunner: {} as any,
    });

    expect(() => runtime.getRootId()).toThrow(
      "Root resource is not available.",
    );
    expect(() => runtime.getRootConfig()).toThrow(
      "Root resource is not available.",
    );
    expect(() => runtime.getRootValue()).toThrow(
      "Root resource is not available.",
    );
  });
});
