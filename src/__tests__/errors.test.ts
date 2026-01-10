import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTag,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../define";
import { run } from "../run";
import {
  duplicateRegistrationError,
  dependencyNotFoundError,
  unknownItemTypeError,
  eventNotFoundError,
  circularDependenciesError,
  lockedError,
  storeAlreadyInitializedError,
  validationError,
  phantomTaskNotRoutedError,
} from "../errors";

describe("Errors", () => {
  it("should throw duplicateRegistration error", async () => {
    const task1 = defineTask({ id: "test.task", run: async () => {} });
    const task2 = defineTask({ id: "test.task", run: async () => {} });

    const app = defineResource({
      id: "app",
      register: [task1, task2],
    });

    await expect(run(app)).rejects.toThrow(
      "Task \"test.task\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("should throw unknown item type error at task level", async () => {
    const task = defineTask({
      id: "test.task",
      dependencies: { nonExistentDep: {} as any },
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(/Unknown item type:/);
  });

  it("should throw unknown item type error at resource level", async () => {
    const app = defineResource({
      id: "app",
      register: [
        {
          id: "nonExistent",
        } as any,
      ],
      async init(_, {}) {},
    });

    await expect(run(app)).rejects.toThrow(/Unknown item type/);
  });

  it("should throw circularDependencies error", async () => {
    const task1: any = defineTask({
      id: "task1",
      dependencies: (): any => ({ task2 }),
      run: async () => {},
    });

    const task2: any = defineTask({
      id: "task2",
      dependencies: { task1 },
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task1, task2],
    });

    await expect(run(app)).rejects.toThrow(/Circular dependencies detected/);
  });

  it("should throw eventNotFound error", async () => {
    const nonExistentEvent = { id: "non.existent.event" } as any;

    const task = defineHook({
      id: "test.task",
      on: nonExistentEvent,
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task],
    });

    await expect(run(app)).rejects.toThrow(
      'Event "non.existent.event" not found. Did you forget to register it?',
    );
  });

  it("should throw EventEmissionCycleError on A->B->A via hooks (dry-run)", async () => {
    const A = defineEvent<void>({ id: "err.A" });
    const B = defineEvent<void>({ id: "err.B" });

    const h1 = defineHook({
      id: "h1",
      on: A,
      dependencies: { B },
      async run() {},
    });
    const h2 = defineHook({
      id: "h2",
      on: B,
      dependencies: { A },
      async run() {},
    });

    const app = defineResource({ id: "err.app", register: [A, B, h1, h2] });

    await expect(run(app, { dryRun: true })).rejects.toThrow(
      /Event emission cycles/i,
    );
  });

  it("should throw taskError", async () => {
    const errorTask = defineTask({
      id: "error.task",
      run: async () => {
        throw new Error("Task error");
      },
    });

    const app = defineResource({
      id: "app",
      register: [errorTask],
      dependencies: { errorTask },
      async init(_, { errorTask }) {
        await errorTask();
      },
    });

    await expect(run(app)).rejects.toThrow(/Task error/);
  });

  it("should throw resourceError", async () => {
    const errorResource = defineResource({
      id: "error.resource",
      init: async () => {
        if (true === true) {
          throw new Error("Resource error");
        }
      },
    });

    const app = defineResource({
      id: "app",
      register: [errorResource],
    });

    await expect(run(app)).rejects.toThrow(/Resource error/);
  });

  it("should throw an ambigous one", async () => {
    const res1 = defineResource({
      id: "res1",
    });

    const ev1 = defineEvent({
      id: "res1",
    });

    const app = defineResource({
      id: "app",
      register: [res1, ev1],
    });

    await expect(run(app)).rejects.toThrow(
      "Resource \"res1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("Should throw duplicate error for tags with the same id", async () => {
    const tag1 = defineTag({
      id: "tag1",
    });
    const tag2 = defineTag({
      id: "tag1",
    });

    const app = defineResource({
      id: "app",
      register: [tag1, tag2],
    });

    await expect(run(app)).rejects.toThrow(
      "Tag \"tag1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("Should throw duplicate error for hooks with the same id", async () => {
    const event = defineEvent({
      id: "event1",
    });
    const hook1 = defineHook({
      id: "hook1",
      on: event,
      run: async () => {},
    });
    const hook2 = defineHook({
      id: "hook1",
      on: event,
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [hook1, hook2],
    });

    await expect(run(app)).rejects.toThrow(
      "Hook \"hook1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("Should throw duplicate error for middlewares with the same id", async () => {
    const middleware1 = defineTaskMiddleware({
      id: "middlewarex",
      run: async () => {},
    });
    const middleware2 = defineTaskMiddleware({
      id: "middlewarex",
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [middleware1, middleware2],
    });

    await expect(run(app)).rejects.toThrow(
      "Middleware \"middlewarex\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("Should throw duplicate error for events with the same id", async () => {
    const ev1 = defineEvent({
      id: "ev1",
    });
    const ev2 = defineEvent({
      id: "ev1",
    });

    const app = defineResource({
      id: "app",
      register: [ev1, ev2],
    });

    await expect(run(app)).rejects.toThrow(
      "Event \"ev1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("should throw an error when a task depends on a non-registered task", async () => {
    const offTheGrid = defineTask({
      id: "test.off.the.grid",
      dependencies: { nonExistentTask: { id: "non" } as any },
      run: async () => {},
    });

    const task = defineTask({
      id: "test.task",
      dependencies: { offTheGrid },
      run: async (_, deps) => {
        throw "Should not even be here";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      "Dependency Task test.off.the.grid not found. Did you forget to register it through a resource?",
    );
  });

  it("should throw when a task depends on a non-registered resource", async () => {
    const offTheGrid = defineResource({
      id: "test.off.the.grid",
      init: async () => {},
    });

    const task = defineTask({
      id: "test.task",
      dependencies: { offTheGrid },
      run: async () => {
        throw "Should not even be here";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      "Dependency Resource test.off.the.grid not found. Did you forget to register it through a resource?",
    );
  });

  it("should throw error when a task depends on a non-registered middleware", async () => {
    const mw = defineTaskMiddleware({ id: "mw", run: async () => {} });
    const task = defineTask({
      id: "test.task",
      middleware: [mw],
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      'Middleware inside task "test.task" depends on "mw" but it\'s not registered. Did you forget to register it?',
    );
  });

  it("should throw error when a resource depends on a non-registered middleware", async () => {
    const mw = defineResourceMiddleware({ id: "mw", run: async () => {} });

    const app = defineResource({
      id: "app",
      middleware: [mw],
    });

    await expect(run(app)).rejects.toThrow(
      'Middleware inside resource "app" depends on "mw" but it\'s not registered. Did you forget to register it?',
    );
  });

  describe("Error Helpers", () => {
    it("throws with correct messages and type guards", () => {
      const capture = (fn: () => void) => {
        try {
          fn();
        } catch (e: any) {
          return e as Error & { name: string; data?: any };
        }
        throw new Error("expected throw");
      };

      const dup = capture(() =>
        duplicateRegistrationError.throw({ type: "Task", id: "test" }),
      );
      expect(dup.message).toContain('Task "test" already registered');
      expect(duplicateRegistrationError.is(dup)).toBe(true);

      const dep = capture(() => dependencyNotFoundError.throw({ key: "X" }));
      expect(dep.message).toContain("Dependency X not found");
      expect(dependencyNotFoundError.is(dep)).toBe(true);

      const unk = capture(() => unknownItemTypeError.throw({ item: "y" }));
      expect(unk.message).toContain("Unknown item type");
      expect(unknownItemTypeError.is(unk)).toBe(true);

      const cyc = capture(() =>
        circularDependenciesError.throw({ cycles: ["a->b->a"] }),
      );
      expect(cyc.message).toContain("Circular dependencies detected");

      const evnf = capture(() => eventNotFoundError.throw({ id: "z" }));
      expect(evnf.message).toContain('Event "z" not found');

      const lock = capture(() => lockedError.throw({ what: "X" }));
      expect(lock.message).toContain("Cannot modify the X");

      const storeE = capture(() => storeAlreadyInitializedError.throw({}));
      expect(storeE.message).toContain("Store already initialized");

      const ve1 = capture(() =>
        validationError.throw({
          subject: "Task input",
          id: "test-task",
          originalError: new Error("Required field missing"),
        }),
      );
      expect(ve1.message).toBe(
        "Task input validation failed for test-task: Required field missing",
      );

      const ve2 = capture(() =>
        validationError.throw({
          subject: "Resource config",
          id: "test-resource",
          originalError: "Invalid configuration",
        }),
      );
      expect(ve2.message).toBe(
        "Resource config validation failed for test-resource: Invalid configuration",
      );

      const phantom = capture(() =>
        phantomTaskNotRoutedError.throw({ taskId: "my.phantom.task" }),
      );
      expect(phantom.message).toContain('Phantom task "my.phantom.task"');
      expect(phantom.message).toContain("not routed through any tunnel");
      expect(phantomTaskNotRoutedError.is(phantom)).toBe(true);
    });
  });
});
