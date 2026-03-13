import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";

/**
 * Verifies that runtime.runTask / emitEvent / getResourceValue /
 * getLazyResourceValue respect the root resource's .isolate({ exports: [...] }) surface.
 *
 * Why: the export visibility model already guards dependency wiring at
 * bootstrap. This coverage ensures the runtime API surface honours the
 * same contract so callers cannot bypass encapsulation by holding a
 * reference to the IRuntime object.
 */
describe("run-runtime-exports", () => {
  // ─── backward compatibility ──────────────────────────────────────────────

  describe("when root has no exports declaration", () => {
    it("allows runTask for any registered task", async () => {
      const inner = defineTask({
        id: "runtime-exports-compat-task",
        run: async () => "ok",
      });
      const root = defineResource({
        id: "runtime-exports-compat-root",
        register: [inner],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(inner)).resolves.toBe("ok");
      await runtime.dispose();
    });

    it("allows emitEvent for any registered event", async () => {
      let hookRan = false;
      const evt = defineEvent<{ v: string }>({
        id: "runtime-exports-compat-event",
      });
      const hook = defineHook({
        id: "runtime-exports-compat-hook",
        on: evt,
        run: async () => {
          hookRan = true;
        },
      });
      const root = defineResource({
        id: "runtime-exports-compat-evt-root",
        register: [evt, hook],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await runtime.emitEvent(evt, { v: "hello" });
      expect(hookRan).toBe(true);
      await runtime.dispose();
    });

    it("allows getResourceValue for any registered resource", async () => {
      const inner = defineResource({
        id: "runtime-exports-compat-resource",
        async init() {
          return "inner-value";
        },
      });
      const root = defineResource({
        id: "runtime-exports-compat-res-root",
        register: [inner],
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(runtime.getResourceValue(inner)).toBe("inner-value");
      await runtime.dispose();
    });
  });

  // ─── runTask ─────────────────────────────────────────────────────────────

  describe("runTask", () => {
    it("allows running an exported task", async () => {
      const exported = defineTask({
        id: "runtime-exports-runTask-exported",
        run: async () => "exported-result",
      });
      const internal = defineTask({
        id: "runtime-exports-runTask-internal",
        run: async () => "internal-result",
      });

      const root = defineResource({
        id: "runtime-exports-runTask-root",
        register: [exported, internal],
        isolate: { exports: [exported] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(exported)).resolves.toBe("exported-result");
      await runtime.dispose();
    });

    it("allows running explicitly exported tasks and blocks hidden ones", async () => {
      const exported = defineTask({
        id: "runtime-exports-runTask-selector-api-task",
        run: async () => "selector-result",
      });
      const hidden = defineTask({
        id: "runtime-exports-runTask-selector-internal-task",
        run: async () => "hidden-result",
      });

      const root = defineResource({
        id: "runtime-exports-runTask-selector-root",
        register: [exported, hidden],
        isolate: { exports: [exported] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(exported)).resolves.toBe("selector-result");
      await expect(runtime.runTask(hidden)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await runtime.dispose();
    });

    it("blocks running a non-exported task", async () => {
      const internal = defineTask({
        id: "runtime-exports-runTask-blocked-internal",
        run: async () => "nope",
      });
      const root = defineResource({
        id: "runtime-exports-runTask-blocked-root",
        register: [internal],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(internal)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await runtime.dispose();
    });

    it("blocks by string id when task is not exported", async () => {
      const internal = defineTask({
        id: "runtime-exports-runTask-str-internal",
        run: async () => "nope",
      });
      const root = defineResource({
        id: "runtime-exports-runTask-str-root",
        register: [internal],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      const internalId = runtime.store.resolveDefinitionId(internal)!;
      await expect(
        Promise.resolve().then(() => runtime.runTask(internalId)),
      ).rejects.toMatchObject({ id: "runtimeAccessViolation" });
      await runtime.dispose();
    });

    it("error carries targetId, rootId, and exportedIds in remediation", async () => {
      expect.assertions(5);

      const taskA = defineTask({
        id: "runtime-exports-runTask-err-a",
        run: async () => "a",
      });
      const taskB = defineTask({
        id: "runtime-exports-runTask-err-b",
        run: async () => "b",
      });
      const root = defineResource({
        id: "runtime-exports-runTask-err-root",
        register: [taskA, taskB],
        isolate: { exports: [taskA] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      try {
        await runtime.runTask(taskB);
      } catch (e: any) {
        expect(e.id).toBe("runtimeAccessViolation");
        expect(String(e.data.targetId)).toMatch(
          /runtime-exports-runTask-err-b$/,
        );
        expect(e.data.rootId).toBe("runtime-exports-runTask-err-root");
        expect(
          (e.data.exportedIds as string[]).some((id) =>
            id.endsWith("runtime-exports-runTask-err-a"),
          ),
        ).toBe(true);
        expect(String(e.remediation)).toContain(
          "runtime-exports-runTask-err-b",
        );
      }
      await runtime.dispose();
    });
  });

  // ─── emitEvent ───────────────────────────────────────────────────────────

  describe("emitEvent", () => {
    it("allows emitting an exported event", async () => {
      const exportedEvt = defineEvent<undefined>({
        id: "runtime-exports-emit-exported",
      });
      const root = defineResource({
        id: "runtime-exports-emit-root",
        register: [exportedEvt],
        isolate: { exports: [exportedEvt] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent(exportedEvt, undefined),
      ).resolves.toBeUndefined();
      await runtime.dispose();
    });

    it("allows emitting explicitly exported events and blocks private ones", async () => {
      const publicEvt = defineEvent<undefined>({
        id: "runtime-exports-emit-selector-public-event",
      });
      const privateEvt = defineEvent<undefined>({
        id: "runtime-exports-emit-selector-private-event",
      });

      const root = defineResource({
        id: "runtime-exports-emit-selector-root",
        register: [publicEvt, privateEvt],
        isolate: { exports: [publicEvt] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent(publicEvt, undefined),
      ).resolves.toBeUndefined();
      await expect(
        runtime.emitEvent(privateEvt, undefined),
      ).rejects.toMatchObject({ id: "runtimeAccessViolation" });
      await runtime.dispose();
    });

    it("blocks emitting a non-exported event", async () => {
      const privateEvt = defineEvent<undefined>({
        id: "runtime-exports-emit-private",
      });
      const root = defineResource({
        id: "runtime-exports-emit-blocked-root",
        register: [privateEvt],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent(privateEvt, undefined),
      ).rejects.toMatchObject({ id: "runtimeAccessViolation" });
      await runtime.dispose();
    });

    it("blocks emitting by string id when event is not exported", async () => {
      const privateEvt = defineEvent<undefined>({
        id: "runtime-exports-emit-str-private",
      });
      const root = defineResource({
        id: "runtime-exports-emit-str-root",
        register: [privateEvt],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      const privateEventId = runtime.store.resolveDefinitionId(privateEvt)!;
      await expect(
        Promise.resolve().then(() =>
          runtime.emitEvent(privateEventId, undefined),
        ),
      ).rejects.toMatchObject({ id: "runtimeAccessViolation" });
      await runtime.dispose();
    });
  });

  // ─── getResourceValue ──────────────────────────────────────────────────

  describe("getResourceValue", () => {
    it("allows accessing an exported resource", async () => {
      const inner = defineResource({
        id: "runtime-exports-getRes-exported",
        async init() {
          return "exported-val";
        },
      });
      const root = defineResource({
        id: "runtime-exports-getRes-root",
        register: [inner],
        isolate: { exports: [inner] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(runtime.getResourceValue(inner)).toBe("exported-val");
      await runtime.dispose();
    });

    it("allows explicitly exported resources and blocks hidden ones", async () => {
      const exported = defineResource({
        id: "runtime-exports-getRes-selector-group-public",
        async init() {
          return "public";
        },
      });
      const hidden = defineResource({
        id: "runtime-exports-getRes-selector-private",
        async init() {
          return "private";
        },
      });
      const root = defineResource({
        id: "runtime-exports-getRes-selector-root",
        register: [exported, hidden],
        isolate: { exports: [exported] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(runtime.getResourceValue(exported)).toBe("public");
      expect(() => runtime.getResourceValue(hidden)).toThrow(
        expect.objectContaining({ id: "runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });

    it("blocks accessing a non-exported resource", async () => {
      const inner = defineResource({
        id: "runtime-exports-getRes-private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime-exports-getRes-blocked-root",
        register: [inner],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(() => runtime.getResourceValue(inner)).toThrow(
        expect.objectContaining({ id: "runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });

    it("blocks by string id when resource is not exported", async () => {
      const inner = defineResource({
        id: "runtime-exports-getRes-str-private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime-exports-getRes-str-root",
        register: [inner],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      const privateResourceId = runtime.store.resolveDefinitionId(inner)!;
      expect(() => runtime.getResourceValue(privateResourceId)).toThrow(
        expect.objectContaining({ id: "runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });
  });

  // ─── getResourceConfig ─────────────────────────────────────────────────

  describe("getResourceConfig", () => {
    it("allows reading config for an exported resource", async () => {
      const inner = defineResource<{ flag: boolean }>({
        id: "runtime-exports-getCfg-exported",
      });
      const root = defineResource({
        id: "runtime-exports-getCfg-root",
        register: [inner.with({ flag: true })],
        isolate: { exports: [inner] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(runtime.getResourceConfig(inner)).toEqual({ flag: true });
      await runtime.dispose();
    });

    it("blocks reading config for non-exported resources", async () => {
      const inner = defineResource<{ flag: boolean }>({
        id: "runtime-exports-getCfg-private",
      });
      const root = defineResource({
        id: "runtime-exports-getCfg-blocked-root",
        register: [inner.with({ flag: true })],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(() => runtime.getResourceConfig(inner)).toThrow(
        expect.objectContaining({ id: "runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });
  });

  // ─── getLazyResourceValue ─────────────────────────────────────────────

  describe("getLazyResourceValue", () => {
    it("allows accessing an exported resource in lazy mode", async () => {
      const inner = defineResource({
        id: "runtime-exports-lazy-exported",
        async init() {
          return "lazy-val";
        },
      });
      const root = defineResource({
        id: "runtime-exports-lazy-root",
        register: [inner],
        isolate: { exports: [inner] },
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });
      await expect(runtime.getLazyResourceValue(inner)).resolves.toBe(
        "lazy-val",
      );
      await runtime.dispose();
    });

    it("allows lazy access through explicitly exported resources only", async () => {
      const exported = defineResource({
        id: "runtime-exports-lazy-selector-group-public",
        async init() {
          return "public";
        },
      });
      const hidden = defineResource({
        id: "runtime-exports-lazy-selector-private",
        async init() {
          return "private";
        },
      });
      const root = defineResource({
        id: "runtime-exports-lazy-selector-root",
        register: [exported, hidden],
        isolate: { exports: [exported] },
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });
      await expect(runtime.getLazyResourceValue(exported)).resolves.toBe(
        "public",
      );
      await expect(runtime.getLazyResourceValue(hidden)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await runtime.dispose();
    });

    it("blocks accessing a non-exported resource in lazy mode", async () => {
      const inner = defineResource({
        id: "runtime-exports-lazy-private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime-exports-lazy-blocked-root",
        register: [inner],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });
      await expect(runtime.getLazyResourceValue(inner)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await runtime.dispose();
    });
  });

  // ─── getHealth ─────────────────────────────────────────────────────────

  describe("getHealth", () => {
    it("returns only exported health-enabled resources when root exports are restricted", async () => {
      const exported = defineResource({
        id: "runtime-exports-health-public",
        async init() {
          return "public";
        },
        async health() {
          return { status: "healthy" };
        },
      });
      const hidden = defineResource({
        id: "runtime-exports-health-private",
        async init() {
          return "private";
        },
        async health() {
          return { status: "unhealthy" };
        },
      });

      const root = defineResource({
        id: "runtime-exports-health-root",
        register: [exported, hidden],
        isolate: { exports: [exported] },
      });

      const runtime = await run(root, { shutdownHooks: false });
      const report = await runtime.getHealth();

      expect(report.totals).toEqual({
        resources: 1,
        healthy: 1,
        degraded: 0,
        unhealthy: 0,
      });
      expect(report.report).toEqual([
        expect.objectContaining({
          id: "runtime-exports-health-root.runtime-exports-health-public",
          status: "healthy",
        }),
      ]);

      await runtime.dispose();
    });

    it("blocks filtered access to non-exported health-enabled resources", async () => {
      const hidden = defineResource({
        id: "runtime-exports-health-filter-private",
        async init() {
          return "private";
        },
        async health() {
          return { status: "healthy" };
        },
      });

      const root = defineResource({
        id: "runtime-exports-health-filter-root",
        register: [hidden],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.getHealth([hidden])).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await runtime.dispose();
    });
  });

  // ─── exports([]) — fully locked surface ──────────────────────────────────

  describe("empty exports list locks the entire runtime surface", () => {
    it("blocks all four methods when root exports nothing", async () => {
      const task = defineTask({
        id: "runtime-exports-empty-task",
        run: async () => "t",
      });
      const evt = defineEvent<undefined>({
        id: "runtime-exports-empty-event",
      });
      const res = defineResource({
        id: "runtime-exports-empty-resource",
        async init() {
          return "r";
        },
      });

      const root = defineResource({
        id: "runtime-exports-empty-root",
        register: [task, evt, res],
        isolate: { exports: "none" },
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });

      await expect(runtime.runTask(task)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      await expect(runtime.emitEvent(evt, undefined)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });
      expect(() => runtime.getResourceValue(res)).toThrow(
        expect.objectContaining({ id: "runtimeAccessViolation" }),
      );
      await expect(runtime.getLazyResourceValue(res)).rejects.toMatchObject({
        id: "runtimeAccessViolation",
      });

      await runtime.dispose();
    });
  });
});
