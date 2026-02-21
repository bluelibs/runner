import {
  dependencyStrategies,
  findDependencyStrategy,
} from "../../../models/utils/dependencyStrategies";
import {
  defineResource,
  defineTask,
  defineEvent,
  defineTag,
} from "../../../define";
import { defineError } from "../../../definers/defineError";
import { defineAsyncContext } from "../../../definers/defineAsyncContext";

// Fixtures
const resource = defineResource({ id: "test.resource", init: async () => 42 });
const task = defineTask({ id: "test.task", run: async () => "ok" });
const event = defineEvent<string>({ id: "test.event" });
const tag = defineTag({ id: "test.tag" });
const errorHelper = defineError({
  id: "test.error",
  format: () => "boom",
});
const asyncCtx = defineAsyncContext<number>({ id: "test.asyncCtx" });

describe("dependencyStrategies", () => {
  describe("strategies list", () => {
    it("contains exactly 6 strategies (resource, task, event, tag, error, asyncContext)", () => {
      expect(dependencyStrategies).toHaveLength(6);
    });

    it("each strategy has matches and getStoreMap", () => {
      for (const s of dependencyStrategies) {
        expect(typeof s.matches).toBe("function");
        expect(typeof s.getStoreMap).toBe("function");
      }
    });
  });

  describe("findDependencyStrategy", () => {
    it("returns the resource strategy for a resource definition", () => {
      const strategy = findDependencyStrategy(resource);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(resource)).toBe(true);
    });

    it("returns the task strategy for a task definition", () => {
      const strategy = findDependencyStrategy(task);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(task)).toBe(true);
    });

    it("returns the event strategy for an event definition", () => {
      const strategy = findDependencyStrategy(event);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(event)).toBe(true);
    });

    it("returns the tag strategy for a tag definition", () => {
      const strategy = findDependencyStrategy(tag);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(tag)).toBe(true);
    });

    it("returns the error strategy for an error helper", () => {
      const strategy = findDependencyStrategy(errorHelper);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(errorHelper)).toBe(true);
    });

    it("returns the asyncContext strategy for an async context", () => {
      const strategy = findDependencyStrategy(asyncCtx);
      expect(strategy).toBeDefined();
      expect(strategy!.matches(asyncCtx)).toBe(true);
    });

    it("returns undefined for an unknown item type", () => {
      const strategy = findDependencyStrategy({ id: "unknown", foo: true });
      expect(strategy).toBeUndefined();
    });

    it("returns undefined for primitives", () => {
      expect(findDependencyStrategy(42)).toBeUndefined();
      expect(findDependencyStrategy("hello")).toBeUndefined();
      expect(findDependencyStrategy(null)).toBeUndefined();
      expect(findDependencyStrategy(undefined)).toBeUndefined();
    });
  });

  describe("getStoreMap", () => {
    it("accesses the correct store map for each strategy", () => {
      // Create a minimal mock store with Map properties
      const mockStore = {
        resources: new Map([["r1", "val1"]]),
        tasks: new Map([["t1", "val2"]]),
        events: new Map([["e1", "val3"]]),
        tags: new Map([["tg1", "valTag"]]),
        errors: new Map([["err1", "val4"]]),
        asyncContexts: new Map([["ac1", "val5"]]),
      } as any;

      const resourceStrategy = findDependencyStrategy(resource)!;
      expect(resourceStrategy.getStoreMap(mockStore).has("r1")).toBe(true);
      expect(resourceStrategy.getStoreMap(mockStore).has("missing")).toBe(
        false,
      );

      const taskStrategy = findDependencyStrategy(task)!;
      expect(taskStrategy.getStoreMap(mockStore).has("t1")).toBe(true);

      const eventStrategy = findDependencyStrategy(event)!;
      expect(eventStrategy.getStoreMap(mockStore).has("e1")).toBe(true);

      const tagStrategy = findDependencyStrategy(tag)!;
      expect(tagStrategy.getStoreMap(mockStore).has("tg1")).toBe(true);

      const errorStrategy = findDependencyStrategy(errorHelper)!;
      expect(errorStrategy.getStoreMap(mockStore).has("err1")).toBe(true);

      const asyncStrategy = findDependencyStrategy(asyncCtx)!;
      expect(asyncStrategy.getStoreMap(mockStore).has("ac1")).toBe(true);
    });
  });
});
