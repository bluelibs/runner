import { scope } from "../../tools/scope";
import { subtreeOf } from "../../public";
import { defineEvent, defineResource, defineTask } from "../../define";
import type { IsolationScope, IsolationScopeTarget } from "../../tools/scope";

describe("scope()", () => {
  const exampleTask = defineTask({
    id: "scope.test.task",
    run: async () => 42,
  });
  const exampleEvent = defineEvent<string>({
    id: "scope.test.event",
  });
  const exampleResource = defineResource({
    id: "scope.test.resource",
  });

  describe("target normalization", () => {
    it("accepts a single definition target", () => {
      const result = scope(exampleTask);
      expect(result._isolationScope).toBe(true);
      expect(result.targets).toEqual([exampleTask]);
    });

    it("accepts an array of targets", () => {
      const targets = [exampleTask, exampleEvent];
      const result = scope(targets);
      expect(result.targets).toEqual(targets);
    });

    it("accepts a subtreeOf filter", () => {
      const filter = subtreeOf(exampleResource);
      const result = scope(filter);
      expect(result.targets).toEqual([filter]);
    });

    it("accepts mixed targets in an array", () => {
      const filter = subtreeOf(exampleResource);
      const targets: IsolationScopeTarget[] = [
        exampleTask,
        filter,
        exampleEvent,
      ];
      const result = scope(targets);
      expect(result.targets).toEqual(targets);
    });
  });

  describe("channel defaults (all true)", () => {
    it("defaults all channels to true when no channels provided", () => {
      const result = scope(exampleTask);
      expect(result.channels).toEqual({
        dependencies: true,
        listening: true,
        tagging: true,
        middleware: true,
      });
    });

    it("defaults all channels to true when empty channels object provided", () => {
      const result = scope(exampleTask, {});
      expect(result.channels).toEqual({
        dependencies: true,
        listening: true,
        tagging: true,
        middleware: true,
      });
    });
  });

  describe("partial channel overrides", () => {
    it("honors explicit dependencies:false while defaulting others", () => {
      const result = scope(exampleTask, { dependencies: false });
      expect(result.channels).toEqual({
        dependencies: false,
        listening: true,
        tagging: true,
        middleware: true,
      });
    });

    it("honors explicit listening:false while defaulting others", () => {
      const result = scope(exampleTask, { listening: false });
      expect(result.channels).toEqual({
        dependencies: true,
        listening: false,
        tagging: true,
        middleware: true,
      });
    });

    it("honors explicit tagging:false while defaulting others", () => {
      const result = scope(exampleTask, { tagging: false });
      expect(result.channels).toEqual({
        dependencies: true,
        listening: true,
        tagging: false,
        middleware: true,
      });
    });

    it("honors explicit middleware:false while defaulting others", () => {
      const result = scope(exampleTask, { middleware: false });
      expect(result.channels).toEqual({
        dependencies: true,
        listening: true,
        tagging: true,
        middleware: false,
      });
    });

    it("allows multiple explicit false values", () => {
      const result = scope(exampleTask, {
        dependencies: false,
        middleware: false,
      });
      expect(result.channels).toEqual({
        dependencies: false,
        listening: true,
        tagging: true,
        middleware: false,
      });
    });

    it("allows all channels explicitly false", () => {
      const result = scope(exampleTask, {
        dependencies: false,
        listening: false,
        tagging: false,
        middleware: false,
      });
      expect(result.channels).toEqual({
        dependencies: false,
        listening: false,
        tagging: false,
        middleware: false,
      });
    });

    it("allows all channels explicitly true", () => {
      const result = scope(exampleTask, {
        dependencies: true,
        listening: true,
        tagging: true,
        middleware: true,
      });
      expect(result.channels).toEqual({
        dependencies: true,
        listening: true,
        tagging: true,
        middleware: true,
      });
    });
  });

  describe("immutability", () => {
    it("returns a frozen object", () => {
      const result = scope(exampleTask);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("has frozen channels", () => {
      const result = scope(exampleTask, { dependencies: false });
      expect(Object.isFrozen(result.channels)).toBe(true);
    });
  });

  describe("type discrimination", () => {
    it("has _isolationScope = true for type guard", () => {
      const result: IsolationScope = scope(exampleTask);
      expect(result._isolationScope).toBe(true);
    });
  });
});
