import { ExecutionJournalImpl } from "../../models/ExecutionJournal";
import { journal as journalFactory } from "../../index";
import { defineResource, defineTask } from "../../define";
import {
  getOrCreateTaskAbortController,
  getTaskAbortSignalLink,
  retainActiveTaskAbortController,
  setTaskCallerSignal,
} from "../../models/runtime/taskCancellation";
import { run } from "../../run";

describe("ExecutionJournal", () => {
  describe("ExecutionJournalImpl", () => {
    it("stores and retrieves values by key", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<string>("test-key");

      journal.set(key, "hello");
      expect(journal.get(key)).toBe("hello");
    });

    it("returns undefined for unset keys", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<number>("missing-key");

      expect(journal.get(key)).toBeUndefined();
    });

    it("has() returns true for set keys", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<boolean>("exists-key");

      expect(journal.has(key)).toBe(false);
      journal.set(key, true);
      expect(journal.has(key)).toBe(true);
    });

    it("supports different value types", () => {
      const journal = new ExecutionJournalImpl();

      const numberKey = journalFactory.createKey<number>("number");
      const objectKey = journalFactory.createKey<{ id: string }>("object");
      const arrayKey = journalFactory.createKey<string[]>("array");

      journal.set(numberKey, 42);
      journal.set(objectKey, { id: "abc" });
      journal.set(arrayKey, ["a", "b"]);

      expect(journal.get(numberKey)).toBe(42);
      expect(journal.get(objectKey)).toEqual({ id: "abc" });
      expect(journal.get(arrayKey)).toEqual(["a", "b"]);
    });

    it("throws when setting existing key without override", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<string>("collision-key");

      journal.set(key, "first");

      expect(() => journal.set(key, "second")).toThrow(
        'Journal key "collision-key" already exists. Use { override: true } to overwrite.',
      );
      // Original value preserved
      expect(journal.get(key)).toBe("first");
    });

    it("allows overwrite with { override: true }", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<string>("overwrite-key");

      journal.set(key, "first");
      journal.set(key, "second", { override: true });

      expect(journal.get(key)).toBe("second");
    });
  });

  describe("createJournalKey", () => {
    it("creates a key with the given id", () => {
      const key = journalFactory.createKey<string>("my-key-id");
      expect(key.id).toBe("my-key-id");
    });

    it("keys with same id share the same storage slot", () => {
      const journal = new ExecutionJournalImpl();
      const key1 = journalFactory.createKey<string>("shared-id");
      const key2 = journalFactory.createKey<string>("shared-id");

      journal.set(key1, "value");
      expect(journal.get(key2)).toBe("value");
    });
  });

  describe("Journal Forwarding", () => {
    it("registers a forwarded journal abort controller lazily and reuses it across nested frames", () => {
      const executionJournal = journalFactory.create();
      const trackedControllers: AbortController[] = [];
      let unregisterCalls = 0;

      const releaseOuter = retainActiveTaskAbortController(
        executionJournal,
        (controller) => {
          trackedControllers.push(controller);
          return () => {
            unregisterCalls += 1;
          };
        },
      );
      const releaseInner = retainActiveTaskAbortController(
        executionJournal,
        (controller) => {
          trackedControllers.push(controller);
          return () => {
            unregisterCalls += 1;
          };
        },
      );

      expect(trackedControllers).toHaveLength(0);

      const controller = getOrCreateTaskAbortController(executionJournal);
      expect(trackedControllers).toEqual([controller]);

      releaseInner();
      expect(unregisterCalls).toBe(0);

      releaseOuter();
      expect(unregisterCalls).toBe(1);

      const releaseReused = retainActiveTaskAbortController(
        executionJournal,
        (controller) => {
          trackedControllers.push(controller);
          return () => {
            unregisterCalls += 1;
          };
        },
      );

      expect(trackedControllers).toEqual([controller, controller]);
      expect(trackedControllers[0]).toBe(trackedControllers[1]);

      releaseReused();
      expect(unregisterCalls).toBe(2);

      expect(() => releaseReused()).not.toThrow();
    });

    it("registers immediately when the journal already owns a task abort controller", () => {
      const executionJournal = journalFactory.create();
      const controller = getOrCreateTaskAbortController(executionJournal);
      const trackedControllers: AbortController[] = [];
      let unregisterCalls = 0;

      const release = retainActiveTaskAbortController(
        executionJournal,
        (trackedController) => {
          trackedControllers.push(trackedController);
          return () => {
            unregisterCalls += 1;
          };
        },
      );

      expect(trackedControllers).toEqual([controller]);

      release();
      expect(unregisterCalls).toBe(1);
    });

    it("does not register when retained tracking is already released before the controller exists", () => {
      const executionJournal = journalFactory.create();
      const trackedControllers: AbortController[] = [];

      const release = retainActiveTaskAbortController(
        executionJournal,
        (controller) => {
          trackedControllers.push(controller);
          return () => undefined;
        },
      );

      release();
      getOrCreateTaskAbortController(executionJournal);

      expect(trackedControllers).toHaveLength(0);
    });

    it("re-registers a reused journal with the latest runtime tracker", () => {
      const executionJournal = journalFactory.create();
      const controller = getOrCreateTaskAbortController(executionJournal);
      const runtimeATracked: AbortController[] = [];
      const runtimeBTracked: AbortController[] = [];

      const releaseA = retainActiveTaskAbortController(
        executionJournal,
        (trackedController) => {
          runtimeATracked.push(trackedController);
          return () => undefined;
        },
      );
      releaseA();

      const releaseB = retainActiveTaskAbortController(
        executionJournal,
        (trackedController) => {
          runtimeBTracked.push(trackedController);
          return () => undefined;
        },
      );

      expect(runtimeATracked).toEqual([controller]);
      expect(runtimeBTracked).toEqual([controller]);

      releaseB();
    });

    it("treats caller-signal cleanup as idempotent", () => {
      const executionJournal = journalFactory.create();
      const controller = new AbortController();
      const cleanupCallerSignal = setTaskCallerSignal(
        executionJournal,
        controller.signal,
      );

      cleanupCallerSignal();
      expect(() => cleanupCallerSignal()).not.toThrow();

      const signalLink = getTaskAbortSignalLink(executionJournal);
      expect(signalLink.signal).toBeUndefined();
      signalLink.cleanup();
    });

    it("forwards journal to nested task when options passed", async () => {
      const traceKey = journalFactory.createKey<string[]>("trace-steps");

      const innerTask = defineTask({
        id: "innerTask",
        run: async (_input, _deps, context) => {
          const steps = context?.journal.get(traceKey) ?? [];
          steps.push("inner");
          context?.journal.set(traceKey, steps, { override: true });
          return "inner-result";
        },
      });

      const outerTask = defineTask({
        id: "outerTask",
        dependencies: { inner: innerTask },
        run: async (_input, { inner }, context) => {
          const steps: string[] = ["outer-before"];
          context?.journal.set(traceKey, steps);

          // Forward journal to inner task
          await inner(undefined, { journal: context?.journal });

          const finalSteps = context?.journal.get(traceKey);
          return finalSteps;
        },
      });

      const app = defineResource({
        id: "app",
        register: [innerTask, outerTask],
        dependencies: { outer: outerTask },
        async init(_, { outer }) {
          const result = await outer(undefined);
          // Both tasks should have written to the same journal
          expect(result).toEqual(["outer-before", "inner"]);
        },
      });

      await run(app);
    });

    it("creates new journal when options not passed", async () => {
      const traceKey = journalFactory.createKey<string[]>("trace-steps");

      const innerTask = defineTask({
        id: "innerTaskNew",
        run: async (_input, _deps, context) => {
          // Should have a fresh journal with no trace
          const steps = context?.journal.get(traceKey);
          expect(steps).toBeUndefined();
          return "inner-result";
        },
      });

      const outerTask = defineTask({
        id: "outerTaskNew",
        dependencies: { inner: innerTask },
        run: async (_input, { inner }, context) => {
          context?.journal.set(traceKey, ["outer"]);

          // Don't forward journal - inner should get fresh one
          await inner(undefined);

          return "done";
        },
      });

      const app = defineResource({
        id: "app",
        register: [innerTask, outerTask],
        dependencies: { outer: outerTask },
        async init(_, { outer }) {
          await outer(undefined);
        },
      });

      await run(app);
    });

    it("composes nested task signals with the forwarded journal signal and restores the parent afterwards", async () => {
      const childController = new AbortController();

      const innerTask = defineTask({
        id: "innerTaskSignalCompose",
        run: async (_input, _deps, context) => {
          if (!context) {
            return "missing-context";
          }

          childController.abort("child-cancel");
          return {
            innerAborted: context.signal?.aborted,
            innerReason: context.signal?.reason,
          };
        },
      });

      const outerTask = defineTask({
        id: "outerTaskSignalCompose",
        dependencies: { inner: innerTask },
        run: async (_input, { inner }, context) => {
          if (!context) {
            return "missing-context";
          }

          try {
            await inner(undefined, {
              journal: context.journal,
              signal: childController.signal,
            });
            return {
              innerRejected: false,
              outerAborted: context.signal?.aborted,
              outerReason: context.signal?.reason,
            };
          } catch (error) {
            return {
              innerRejected: true,
              innerMessage:
                error instanceof Error ? error.message : String(error),
              outerAborted: context.signal?.aborted,
              outerReason: context.signal?.reason,
            };
          }
        },
      });

      const app = defineResource({
        id: "app",
        register: [innerTask, outerTask],
        dependencies: { outer: outerTask },
        async init(_, { outer }) {
          const parentController = new AbortController();
          const result = await outer(undefined, {
            signal: parentController.signal,
          });

          expect(result).toMatchObject({
            innerRejected: true,
            innerMessage: expect.stringContaining("child-cancel"),
            outerAborted: false,
            outerReason: undefined,
          });
        },
      });

      await run(app);
    });
  });

  describe("journal-create", () => {
    it("creates an empty journal", () => {
      const journal = journalFactory.create();
      expect(journal).toBeInstanceOf(ExecutionJournalImpl);
      const key = journalFactory.createKey<string>("test-key");
      expect(journal.get(key)).toBeUndefined();
    });
  });
});
