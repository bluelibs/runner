import { defineResource } from "../../define";
import { subtreeOf } from "../../public";

describe("subtreeOf()", () => {
  it("clones and freezes the types array", () => {
    const resource = defineResource({ id: "subtree.types.resource" });
    const inputTypes = ["task", "event"] as const;

    const filter = subtreeOf(resource, { types: inputTypes });

    expect(filter.types).toEqual(["task", "event"]);
    expect(filter.types).not.toBe(inputTypes);
    expect(Object.isFrozen(filter)).toBe(true);
    expect(Object.isFrozen(filter.types)).toBe(true);
  });

  it("does not retain later mutations from the caller array", () => {
    const resource = defineResource({ id: "subtree.mutation.resource" });
    const inputTypes = ["task"] as Array<"task" | "event">;

    const filter = subtreeOf(resource, { types: inputTypes });
    inputTypes.push("event");

    expect(filter.types).toEqual(["task"]);
  });

  it("fails fast for invalid item types", () => {
    const resource = defineResource({ id: "subtree.invalid.resource" });

    expect(() =>
      subtreeOf(resource, {
        types: ["not-a-real-type"] as any,
      }),
    ).toThrow(expect.objectContaining({ id: "runner.errors.validation" }));
  });

  it("fails fast when types is not an array", () => {
    const resource = defineResource({ id: "subtree.invalid-shape.resource" });

    expect(() =>
      subtreeOf(resource, {
        types: "task" as any,
      }),
    ).toThrow(expect.objectContaining({ id: "runner.errors.validation" }));
  });

  it("fails fast when an item type is not a string", () => {
    const resource = defineResource({ id: "subtree.invalid-type.resource" });

    expect(() =>
      subtreeOf(resource, {
        types: [123] as any,
      }),
    ).toThrow(expect.objectContaining({ id: "runner.errors.validation" }));
  });

  it("falls back to String(value) when invalid types cannot be JSON stringified", () => {
    const resource = defineResource({ id: "subtree.undefined-type.resource" });

    expect(() =>
      subtreeOf(resource, {
        types: [undefined] as any,
      }),
    ).toThrow(expect.objectContaining({ id: "runner.errors.validation" }));
  });
});
