import { ExecutionJournalImpl } from "../../models/ExecutionJournal";
import { journal as journalFactory } from "../../index";
import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("ExecutionJournal", () => {
  describe("ExecutionJournalImpl", () => {
    it("stores and retrieves values by key", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<string>("test.key");

      journal.set(key, "hello");
      expect(journal.get(key)).toBe("hello");
    });

    it("returns undefined for unset keys", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<number>("missing.key");

      expect(journal.get(key)).toBeUndefined();
    });

    it("has() returns true for set keys", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<boolean>("exists.key");

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

    it("overwrites existing values", () => {
      const journal = new ExecutionJournalImpl();
      const key = journalFactory.createKey<string>("overwrite");

      journal.set(key, "first");
      journal.set(key, "second");

      expect(journal.get(key)).toBe("second");
    });
  });

  describe("createJournalKey", () => {
    it("creates a key with the given id", () => {
      const key = journalFactory.createKey<string>("my.key.id");
      expect(key.id).toBe("my.key.id");
    });

    it("keys with same id share the same storage slot", () => {
      const journal = new ExecutionJournalImpl();
      const key1 = journalFactory.createKey<string>("shared.id");
      const key2 = journalFactory.createKey<string>("shared.id");

      journal.set(key1, "value");
      expect(journal.get(key2)).toBe("value");
    });
  });

  describe("Journal Forwarding", () => {
    it("forwards journal to nested task when options passed", async () => {
      const traceKey = journalFactory.createKey<string[]>("trace.steps");

      const innerTask = defineTask({
        id: "innerTask",
        run: async (_input, _deps, context) => {
          const steps = context?.journal.get(traceKey) ?? [];
          steps.push("inner");
          context?.journal.set(traceKey, steps);
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
      const traceKey = journalFactory.createKey<string[]>("trace.steps");

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
  });

  describe("journal.create", () => {
    it("creates an empty journal", () => {
      const journal = journalFactory.create();
      expect(journal).toBeInstanceOf(ExecutionJournalImpl);
      const key = journalFactory.createKey<string>("test.key");
      expect(journal.get(key)).toBeUndefined();
    });
  });
});
