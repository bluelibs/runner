import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";

/**
 * Verifies that runtime.runTask / emitEvent / getResourceValue /
 * getLazyResourceValue respect the root resource's .exports([...]) surface.
 *
 * Why: the export visibility model already guards dependency wiring at
 * bootstrap. This coverage ensures the runtime API surface honours the
 * same contract so callers cannot bypass encapsulation by holding a
 * reference to the IRuntime object.
 */
describe("run.runtime-exports", () => {
  // ─── backward compatibility ──────────────────────────────────────────────

  describe("when root has no exports declaration", () => {
    it("allows runTask for any registered task", async () => {
      const inner = defineTask({
        id: "runtime.exports.compat.task",
        run: async () => "ok",
      });
      const root = defineResource({
        id: "runtime.exports.compat.root",
        register: [inner],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(inner)).resolves.toBe("ok");
      await runtime.dispose();
    });

    it("allows emitEvent for any registered event", async () => {
      let hookRan = false;
      const evt = defineEvent<{ v: string }>({
        id: "runtime.exports.compat.event",
      });
      const hook = defineHook({
        id: "runtime.exports.compat.hook",
        on: evt,
        run: async () => {
          hookRan = true;
        },
      });
      const root = defineResource({
        id: "runtime.exports.compat.evt.root",
        register: [evt, hook],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await runtime.emitEvent(evt, { v: "hello" });
      expect(hookRan).toBe(true);
      await runtime.dispose();
    });

    it("allows getResourceValue for any registered resource", async () => {
      const inner = defineResource({
        id: "runtime.exports.compat.resource",
        async init() {
          return "inner-value";
        },
      });
      const root = defineResource({
        id: "runtime.exports.compat.res.root",
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
        id: "runtime.exports.runTask.exported",
        run: async () => "exported-result",
      });
      const internal = defineTask({
        id: "runtime.exports.runTask.internal",
        run: async () => "internal-result",
      });

      const root = defineResource({
        id: "runtime.exports.runTask.root",
        register: [exported, internal],
        exports: [exported],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(exported)).resolves.toBe("exported-result");
      await runtime.dispose();
    });

    it("blocks running a non-exported task", async () => {
      const internal = defineTask({
        id: "runtime.exports.runTask.blocked.internal",
        run: async () => "nope",
      });
      const root = defineResource({
        id: "runtime.exports.runTask.blocked.root",
        register: [internal],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(runtime.runTask(internal)).rejects.toMatchObject({
        id: "runner.errors.runtimeAccessViolation",
      });
      await runtime.dispose();
    });

    it("blocks by string id when task is not exported", async () => {
      const internal = defineTask({
        id: "runtime.exports.runTask.str.internal",
        run: async () => "nope",
      });
      const root = defineResource({
        id: "runtime.exports.runTask.str.root",
        register: [internal],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.runTask("runtime.exports.runTask.str.internal"),
      ).rejects.toMatchObject({ id: "runner.errors.runtimeAccessViolation" });
      await runtime.dispose();
    });

    it("error carries targetId, rootId, and exportedIds in remediation", async () => {
      expect.assertions(5);

      const taskA = defineTask({
        id: "runtime.exports.runTask.err.a",
        run: async () => "a",
      });
      const taskB = defineTask({
        id: "runtime.exports.runTask.err.b",
        run: async () => "b",
      });
      const root = defineResource({
        id: "runtime.exports.runTask.err.root",
        register: [taskA, taskB],
        exports: [taskA],
      });

      const runtime = await run(root, { shutdownHooks: false });
      try {
        await runtime.runTask(taskB);
      } catch (e: any) {
        expect(e.id).toBe("runner.errors.runtimeAccessViolation");
        expect(e.data.targetId).toBe("runtime.exports.runTask.err.b");
        expect(e.data.rootId).toBe("runtime.exports.runTask.err.root");
        expect(e.data.exportedIds).toContain("runtime.exports.runTask.err.a");
        expect(e.remediation).toContain("runtime.exports.runTask.err.b");
      }
      await runtime.dispose();
    });
  });

  // ─── emitEvent ───────────────────────────────────────────────────────────

  describe("emitEvent", () => {
    it("allows emitting an exported event", async () => {
      const exportedEvt = defineEvent<undefined>({
        id: "runtime.exports.emit.exported",
      });
      const root = defineResource({
        id: "runtime.exports.emit.root",
        register: [exportedEvt],
        exports: [exportedEvt],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent(exportedEvt, undefined),
      ).resolves.not.toThrow();
      await runtime.dispose();
    });

    it("blocks emitting a non-exported event", async () => {
      const privateEvt = defineEvent<undefined>({
        id: "runtime.exports.emit.private",
      });
      const root = defineResource({
        id: "runtime.exports.emit.blocked.root",
        register: [privateEvt],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent(privateEvt, undefined),
      ).rejects.toMatchObject({ id: "runner.errors.runtimeAccessViolation" });
      await runtime.dispose();
    });

    it("blocks emitting by string id when event is not exported", async () => {
      const privateEvt = defineEvent<undefined>({
        id: "runtime.exports.emit.str.private",
      });
      const root = defineResource({
        id: "runtime.exports.emit.str.root",
        register: [privateEvt],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      await expect(
        runtime.emitEvent("runtime.exports.emit.str.private", undefined),
      ).rejects.toMatchObject({ id: "runner.errors.runtimeAccessViolation" });
      await runtime.dispose();
    });
  });

  // ─── getResourceValue ──────────────────────────────────────────────────

  describe("getResourceValue", () => {
    it("allows accessing an exported resource", async () => {
      const inner = defineResource({
        id: "runtime.exports.getRes.exported",
        async init() {
          return "exported-val";
        },
      });
      const root = defineResource({
        id: "runtime.exports.getRes.root",
        register: [inner],
        exports: [inner],
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(runtime.getResourceValue(inner)).toBe("exported-val");
      await runtime.dispose();
    });

    it("blocks accessing a non-exported resource", async () => {
      const inner = defineResource({
        id: "runtime.exports.getRes.private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime.exports.getRes.blocked.root",
        register: [inner],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(() => runtime.getResourceValue(inner)).toThrow(
        expect.objectContaining({ id: "runner.errors.runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });

    it("blocks by string id when resource is not exported", async () => {
      const inner = defineResource({
        id: "runtime.exports.getRes.str.private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime.exports.getRes.str.root",
        register: [inner],
        exports: [],
      });

      const runtime = await run(root, { shutdownHooks: false });
      expect(() =>
        runtime.getResourceValue("runtime.exports.getRes.str.private"),
      ).toThrow(
        expect.objectContaining({ id: "runner.errors.runtimeAccessViolation" }),
      );
      await runtime.dispose();
    });
  });

  // ─── getLazyResourceValue ─────────────────────────────────────────────

  describe("getLazyResourceValue", () => {
    it("allows accessing an exported resource in lazy mode", async () => {
      const inner = defineResource({
        id: "runtime.exports.lazy.exported",
        async init() {
          return "lazy-val";
        },
      });
      const root = defineResource({
        id: "runtime.exports.lazy.root",
        register: [inner],
        exports: [inner],
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });
      await expect(runtime.getLazyResourceValue(inner)).resolves.toBe(
        "lazy-val",
      );
      await runtime.dispose();
    });

    it("blocks accessing a non-exported resource in lazy mode", async () => {
      const inner = defineResource({
        id: "runtime.exports.lazy.private",
        async init() {
          return "secret";
        },
      });
      const root = defineResource({
        id: "runtime.exports.lazy.blocked.root",
        register: [inner],
        exports: [],
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });
      await expect(runtime.getLazyResourceValue(inner)).rejects.toMatchObject({
        id: "runner.errors.runtimeAccessViolation",
      });
      await runtime.dispose();
    });
  });

  // ─── exports([]) — fully locked surface ──────────────────────────────────

  describe("empty exports list locks the entire runtime surface", () => {
    it("blocks all four methods when root exports nothing", async () => {
      const task = defineTask({
        id: "runtime.exports.empty.task",
        run: async () => "t",
      });
      const evt = defineEvent<undefined>({
        id: "runtime.exports.empty.event",
      });
      const res = defineResource({
        id: "runtime.exports.empty.resource",
        async init() {
          return "r";
        },
      });

      const root = defineResource({
        id: "runtime.exports.empty.root",
        register: [task, evt, res],
        exports: [],
      });

      const runtime = await run(root, { lazy: true, shutdownHooks: false });

      await expect(runtime.runTask(task)).rejects.toMatchObject({
        id: "runner.errors.runtimeAccessViolation",
      });
      await expect(runtime.emitEvent(evt, undefined)).rejects.toMatchObject({
        id: "runner.errors.runtimeAccessViolation",
      });
      expect(() => runtime.getResourceValue(res)).toThrow(
        expect.objectContaining({ id: "runner.errors.runtimeAccessViolation" }),
      );
      await expect(runtime.getLazyResourceValue(res)).rejects.toMatchObject({
        id: "runner.errors.runtimeAccessViolation",
      });

      await runtime.dispose();
    });
  });
});
