import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";

describe("run.exports-visibility cross-cutting surfaces (strict privacy)", () => {
  describe("hooks and events", () => {
    it("blocks hooks from listening to non-exported events", async () => {
      const secretEvent = defineEvent<{ value: string }>({
        id: "exports.strict.events.secret",
      });

      const child = defineResource({
        id: "exports.strict.events.child",
        register: [secretEvent],
        exports: [],
      });

      const hook = defineHook({
        id: "exports.strict.events.hook",
        on: secretEvent,
        run: async () => {},
      });

      const root = defineResource({
        id: "exports.strict.events.root",
        register: [child, hook],
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.strict\.events\.secret.*internal.*exports\.strict\.events\.child/,
      );
    });

    it("allows hooks to listen to exported events", async () => {
      const secretEvent = defineEvent<{ value: string }>({
        id: "exports.strict.events-ok.secret",
      });
      const hookCalled = jest.fn();

      const child = defineResource({
        id: "exports.strict.events-ok.child",
        register: [secretEvent],
        exports: [secretEvent],
      });

      const hook = defineHook({
        id: "exports.strict.events-ok.hook",
        on: secretEvent,
        run: async (event) => {
          hookCalled(event.data.value);
        },
      });

      const emitter = defineTask({
        id: "exports.strict.events-ok.emitter",
        dependencies: { secretEvent },
        run: async (_, deps) => {
          await deps.secretEvent({ value: "ok" });
          return "done";
        },
      });

      const root = defineResource({
        id: "exports.strict.events-ok.root",
        register: [child, hook, emitter],
        dependencies: { emitter },
        async init(_, deps) {
          return await deps.emitter();
        },
      });

      const runtime = await run(root);
      expect(runtime.value).toBe("done");
      expect(hookCalled).toHaveBeenCalledWith("ok");
      await runtime.dispose();
    });
  });

  describe("middleware", () => {
    it("blocks tasks from using non-exported task middleware", async () => {
      const internalMiddleware = defineTaskMiddleware({
        id: "exports.strict.taskmw.internal",
        run: async ({ next }) => next(),
      });

      const child = defineResource({
        id: "exports.strict.taskmw.child",
        register: [internalMiddleware],
        exports: [],
      });

      const task = defineTask({
        id: "exports.strict.taskmw.consumer",
        middleware: [internalMiddleware],
        run: async () => "done",
      });

      const root = defineResource({
        id: "exports.strict.taskmw.root",
        register: [child, task],
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.strict\.taskmw\.internal.*internal.*exports\.strict\.taskmw\.child/,
      );
    });

    it("allows tasks to use exported task middleware", async () => {
      const internalMiddleware = defineTaskMiddleware({
        id: "exports.strict.taskmw-ok.internal",
        run: async ({ next }) => next(),
      });

      const child = defineResource({
        id: "exports.strict.taskmw-ok.child",
        register: [internalMiddleware],
        exports: [internalMiddleware],
      });

      const task = defineTask({
        id: "exports.strict.taskmw-ok.consumer",
        middleware: [internalMiddleware],
        run: async () => "done",
      });

      const root = defineResource({
        id: "exports.strict.taskmw-ok.root",
        register: [child, task],
        dependencies: { task },
        async init(_, deps) {
          return await deps.task();
        },
      });

      const runtime = await run(root);
      expect(runtime.value).toBe("done");
      await runtime.dispose();
    });

    it("blocks resources from using non-exported resource middleware", async () => {
      const internalResourceMiddleware = defineResourceMiddleware({
        id: "exports.strict.resmw.internal",
        run: async ({ next }) => next(),
      });

      const child = defineResource({
        id: "exports.strict.resmw.child",
        register: [internalResourceMiddleware],
        exports: [],
      });

      const consumer = defineResource({
        id: "exports.strict.resmw.consumer",
        middleware: [internalResourceMiddleware],
        async init() {
          return "done";
        },
      });

      const root = defineResource({
        id: "exports.strict.resmw.root",
        register: [child, consumer],
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.strict\.resmw\.internal.*internal.*exports\.strict\.resmw\.child/,
      );
    });

    it("scopes private everywhere task middleware to its subtree", async () => {
      const internalEverywhere = defineTaskMiddleware({
        id: "exports.strict.everywhere.task.internal",
        everywhere: true,
        run: async ({ next }) => {
          const result = await next();
          return `mw:${result}`;
        },
      });

      const internalTask = defineTask({
        id: "exports.strict.everywhere.task.internal-task",
        run: async () => "internal",
      });
      const externalTask = defineTask({
        id: "exports.strict.everywhere.task.external-task",
        run: async () => "external",
      });

      const child = defineResource({
        id: "exports.strict.everywhere.task.child",
        register: [internalEverywhere, internalTask],
        exports: [],
        dependencies: { internalTask },
        async init(_, deps) {
          return await deps.internalTask();
        },
      });

      const root = defineResource({
        id: "exports.strict.everywhere.task.root",
        register: [child, externalTask],
        dependencies: { child, externalTask },
        async init(_, deps) {
          return {
            internal: deps.child,
            external: await deps.externalTask(),
          };
        },
      });

      const runtime = await run(root);
      expect(runtime.value).toEqual({
        internal: "mw:internal",
        external: "external",
      });
      await runtime.dispose();
    });

    it("scopes private everywhere resource middleware to its subtree", async () => {
      const internalEverywhere = defineResourceMiddleware({
        id: "exports.strict.everywhere.resource.internal",
        everywhere: (resource) =>
          resource.id ===
          "exports.strict.everywhere.resource.internal-resource",
        run: async ({ next }) => {
          const result = await next();
          return `mw:${result}`;
        },
      });

      const internalResource = defineResource({
        id: "exports.strict.everywhere.resource.internal-resource",
        async init() {
          return "internal";
        },
      });
      const externalResource = defineResource({
        id: "exports.strict.everywhere.resource.external-resource",
        async init() {
          return "external";
        },
      });

      const child = defineResource({
        id: "exports.strict.everywhere.resource.child",
        register: [internalEverywhere, internalResource],
        exports: [],
        dependencies: { internalResource },
        async init(_, deps) {
          return deps.internalResource;
        },
      });

      const root = defineResource({
        id: "exports.strict.everywhere.resource.root",
        register: [child, externalResource],
        dependencies: { child, externalResource },
        async init(_, deps) {
          return {
            internal: deps.child,
            external: deps.externalResource,
          };
        },
      });

      const runtime = await run(root);
      expect(runtime.value).toEqual({
        internal: "mw:internal",
        external: "external",
      });
      await runtime.dispose();
    });
  });

  describe("hook dependencies", () => {
    it("blocks hooks from depending on non-exported tasks", async () => {
      const privateTask = defineTask({
        id: "exports.strict.hookdep.private",
        run: async () => "private",
      });

      const event = defineEvent<void>({
        id: "exports.strict.hookdep.event",
      });

      const child = defineResource({
        id: "exports.strict.hookdep.child",
        register: [privateTask],
        exports: [],
      });

      const hook = defineHook({
        id: "exports.strict.hookdep.hook",
        on: event,
        dependencies: { privateTask },
        run: async () => {},
      });

      const root = defineResource({
        id: "exports.strict.hookdep.root",
        register: [child, event, hook],
      });

      await expect(run(root)).rejects.toThrow(
        /exports\.strict\.hookdep\.private.*internal.*exports\.strict\.hookdep\.child/,
      );
    });
  });
});
