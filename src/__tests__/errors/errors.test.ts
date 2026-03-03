import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTag,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { run } from "../../run";
import {
  duplicateRegistrationError,
  dependencyNotFoundError,
  isolateInvalidEntryError,
  isolateUnknownTargetError,
  isolateViolationError,
  isolateConflictError,
  transactionalEventLaneConflictError,
  transactionalMissingUndoClosureError,
  transactionalParallelConflictError,
  transactionalRollbackFailureError,
  unknownItemTypeError,
  eventNotFoundError,
  circularDependencyError,
  lockedError,
  storeAlreadyInitializedError,
  validationError,
  createMessageError,
} from "../../errors";

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
      // @ts-expect-error Testing invalid dependency type
      dependencies: { nonExistentDep: {} },
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
        // @ts-expect-error Testing invalid item
        {
          id: "nonExistent",
        },
      ],
      async init(_, {}) {},
    });

    await expect(run(app)).rejects.toThrow(/Unknown item type/);
  });

  it("should throw circularDependencies error", async () => {
    const task1 = defineTask({
      id: "task1",
      dependencies: () => ({ task2 }),
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
    const nonExistentEvent = { id: "non.existent.event" };

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
        throw createMessageError("Task error");
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
          throw createMessageError("Resource error");
        }
      },
    });

    const app = defineResource({
      id: "app",
      register: [errorResource],
    });

    await expect(run(app)).rejects.toThrow(/Resource error/);
  });

  it("allows resource/event local-name collisions by using scoped ids", async () => {
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

    const runtime = await run(app);
    expect(runtime.store.resources.has("app.res1")).toBe(true);
    expect(runtime.store.events.has("app.events.res1")).toBe(true);
    expect("app.res1").not.toBe("app.events.res1");
    await runtime.dispose();
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
      "Tag \"app.tags.tag1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
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
      "Hook \"app.hooks.hook1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
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
      "Middleware \"app.middleware.task.middlewarex\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
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
      "Event \"app.events.ev1\" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.",
    );
  });

  it("should throw an error when a task depends on a non-registered task", async () => {
    const offTheGrid = defineTask({
      id: "test.off.the.grid",
      // @ts-expect-error Testing invalid dependency definition
      dependencies: { nonExistentTask: { id: "non" } },
      run: async () => {},
    });

    const task = defineTask({
      id: "test.task",
      dependencies: { offTheGrid },
      run: async (_, _deps) => {
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
        } catch (e: unknown) {
          return e as Error & { name: string; data?: any };
        }
        throw createMessageError("expected throw");
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
        circularDependencyError.throw({ cycles: ["a->b->a"] }),
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
      expect(ve1.message).toContain(
        "Task input validation failed for test-task: Required field missing",
      );

      const ve2 = capture(() =>
        validationError.throw({
          subject: "Resource config",
          id: "test-resource",
          originalError: "Invalid configuration",
        }),
      );
      expect(ve2.message).toContain(
        "Resource config validation failed for test-resource: Invalid configuration",
      );

      const policyInvalid = capture(() =>
        isolateInvalidEntryError.throw({
          policyResourceId: "app.resource",
          entry: {},
        }),
      );
      expect(policyInvalid.message).toContain(
        'Resource "app.resource" declares an invalid isolate policy entry.',
      );

      const policyUnknown = capture(() =>
        isolateUnknownTargetError.throw({
          policyResourceId: "app.resource",
          targetId: "missing.target",
        }),
      );
      expect(policyUnknown.message).toContain(
        'Resource "app.resource" references unknown target "missing.target"',
      );

      const policyConflict = capture(() =>
        isolateConflictError.throw({
          policyResourceId: "app.resource",
        }),
      );
      expect(policyConflict.message).toContain(
        'Resource "app.resource" declares both "deny" and "only"',
      );

      const policyViolation = capture(() =>
        isolateViolationError.throw({
          targetId: "tasks.secret",
          targetType: "Task",
          consumerId: "tasks.consumer",
          consumerType: "Task",
          policyResourceId: "resources.boundary",
          matchedRuleType: "tag",
          matchedRuleId: "tags.secret",
        }),
      );
      expect(policyViolation.message).toContain(
        'Task "tasks.secret" is denied by isolate policy on resource "resources.boundary"',
      );

      const policyOnlyViolation = capture(() =>
        isolateViolationError.throw({
          targetId: "tasks.secret",
          targetType: "Task",
          consumerId: "tasks.consumer",
          consumerType: "Task",
          policyResourceId: "resources.boundary",
          matchedRuleType: "only",
          matchedRuleId: "tasks.secret",
        }),
      );
      expect(policyOnlyViolation.message).toContain(
        'not allowed by isolate "only" rule on resource "resources.boundary"',
      );

      const txParallel = capture(() =>
        transactionalParallelConflictError.throw({
          eventId: "events.tx.invalid",
        }),
      );
      expect(txParallel.message).toContain(
        'Event "events.tx.invalid" cannot be both transactional and parallel.',
      );
      expect(transactionalParallelConflictError.is(txParallel)).toBe(true);

      const txLane = capture(() =>
        transactionalEventLaneConflictError.throw({
          eventId: "events.tx.lane.invalid",
          tagId: "r.runner.tags.eventLane",
        }),
      );
      expect(txLane.message).toContain(
        'Event "events.tx.lane.invalid" cannot be transactional while using lane tag "r.runner.tags.eventLane".',
      );
      expect(transactionalEventLaneConflictError.is(txLane)).toBe(true);

      const txMissingUndo = capture(() =>
        transactionalMissingUndoClosureError.throw({
          eventId: "events.tx.missingUndo",
          listenerId: "hooks.tx.listener",
          listenerOrder: 5,
        }),
      );
      expect(txMissingUndo.message).toContain(
        'Transactional listener for event "events.tx.missingUndo" did not return an undo closure',
      );
      expect(transactionalMissingUndoClosureError.is(txMissingUndo)).toBe(true);

      const txMissingUndoUnknown = capture(() =>
        transactionalMissingUndoClosureError.throw({
          eventId: "events.tx.missingUndo.unknown",
        }),
      );
      expect(txMissingUndoUnknown.message).toContain("listenerId=unknown");
      expect(txMissingUndoUnknown.message).toContain("order=unknown");

      const txRollback = capture(() =>
        transactionalRollbackFailureError.throw({
          eventId: "events.tx.rollback",
          triggerMessage: "listener failed",
          triggerListenerId: "hooks.tx.trigger",
          triggerListenerOrder: 3,
          rollbackFailures: [
            {
              message: "undo failed",
              listenerId: "hooks.tx.undo",
              listenerOrder: 1,
            },
          ],
        }),
      );
      expect(txRollback.message).toContain(
        'Transactional event "events.tx.rollback" failed and rollback had 1 error(s).',
      );
      expect(txRollback.message).toContain("undo failed");
      expect(transactionalRollbackFailureError.is(txRollback)).toBe(true);

      const txRollbackUnknown = capture(() =>
        transactionalRollbackFailureError.throw({
          eventId: "events.tx.rollback.unknown",
          triggerMessage: "listener failed",
          rollbackFailures: [{ message: "undo failed" }],
        }),
      );
      expect(txRollbackUnknown.message).toContain("listenerId=unknown");
      expect(txRollbackUnknown.message).toContain("order=unknown");
    });
  });
});
