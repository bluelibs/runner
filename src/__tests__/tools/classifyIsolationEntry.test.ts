import {
  classifyIsolationEntry,
  classifyScopeTarget,
} from "../../tools/classifyIsolationEntry";
import { defineResource, defineTag, defineTask } from "../../define";
import { subtreeOf } from "../../public";
import { scope } from "../../tools/scope";

const testTag = defineTag({ id: "test-classify-tag" });
const testTask = defineTask({
  id: "test-classify-task",
  run: async () => {},
});
const testResource = defineResource({
  id: "test-classify-resource",
  init: async () => ({}),
});

describe("classifyIsolationEntry", () => {
  it("classifies a scope entry", () => {
    const s = scope(testTask);
    const result = classifyIsolationEntry(s);
    expect(result.kind).toBe("scope");
  });

  it("classifies a subtreeFilter entry", () => {
    const filter = subtreeOf(testResource);
    const result = classifyIsolationEntry(filter);
    expect(result.kind).toBe("subtreeFilter");
  });

  it("classifies a string entry", () => {
    const result = classifyIsolationEntry("some-id");
    expect(result).toEqual({ kind: "string", value: "some-id" });
  });

  it("classifies a tag entry", () => {
    const result = classifyIsolationEntry(testTag);
    expect(result.kind).toBe("tag");
    if (result.kind === "tag") {
      expect(result.id).toBe("test-classify-tag");
    }
  });

  it("classifies a definition (task)", () => {
    const result = classifyIsolationEntry(testTask);
    expect(result.kind).toBe("definition");
    if (result.kind === "definition") {
      expect(result.id).toBe("test-classify-task");
    }
  });

  it("classifies a definition (resource)", () => {
    const result = classifyIsolationEntry(testResource);
    expect(result.kind).toBe("definition");
    if (result.kind === "definition") {
      expect(result.id).toBe("test-classify-resource");
    }
  });

  it("classifies a resource with config", () => {
    const withConfig = { resource: testResource, config: {} };
    const result = classifyIsolationEntry(withConfig);
    expect(result.kind).toBe("definition");
    if (result.kind === "definition") {
      expect(result.id).toBe("test-classify-resource");
    }
  });

  it("classifies an unknown entry (number)", () => {
    const result = classifyIsolationEntry(42);
    expect(result).toEqual({ kind: "unknown", entry: 42 });
  });

  it("classifies an unknown entry (object without id)", () => {
    const result = classifyIsolationEntry({ foo: "bar" });
    expect(result).toEqual({ kind: "unknown", entry: { foo: "bar" } });
  });

  it("classifies null as unknown", () => {
    const result = classifyIsolationEntry(null);
    expect(result).toEqual({ kind: "unknown", entry: null });
  });

  it("classifies a function with id as unknown", () => {
    const fn = Object.assign(() => undefined, { id: "fn-id" });
    const result = classifyIsolationEntry(fn);
    expect(result).toEqual({ kind: "unknown", entry: fn });
  });
});

describe("classifyScopeTarget", () => {
  it("classifies a subtreeFilter", () => {
    const filter = subtreeOf(testResource);
    const result = classifyScopeTarget(filter);
    expect(result.kind).toBe("subtreeFilter");
  });

  it("classifies a string", () => {
    const result = classifyScopeTarget("target-id");
    expect(result).toEqual({ kind: "string", value: "target-id" });
  });

  it("classifies a tag", () => {
    const result = classifyScopeTarget(testTag);
    expect(result.kind).toBe("tag");
  });

  it("classifies a definition", () => {
    const result = classifyScopeTarget(testTask);
    expect(result.kind).toBe("definition");
  });

  it("classifies unknown entry", () => {
    const result = classifyScopeTarget(123);
    expect(result).toEqual({ kind: "unknown", entry: 123 });
  });
});
