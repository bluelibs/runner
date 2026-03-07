import { defineResourceMiddleware, defineTaskMiddleware } from "../../define";
import {
  mergeResourceSubtreePolicy,
  normalizeResourceSubtreePolicy,
} from "../../definers/subtreePolicy";

describe("subtree policy normalization", () => {
  const taskMw = defineTaskMiddleware({
    id: "tests-subtree-task-mw",
    run: async ({ next }) => next(),
  });
  const resourceMw = defineResourceMiddleware({
    id: "tests-subtree-resource-mw",
    run: async ({ next }) => next(),
  });

  it("normalizes validate to an array", () => {
    const validator = () => [{ code: "custom" as const, message: "x" }];

    const result = normalizeResourceSubtreePolicy({
      validate: validator,
      tasks: {
        middleware: [taskMw],
      },
      resources: {
        middleware: [resourceMw],
      },
    });

    expect(result?.validate).toEqual([validator]);
    expect(result?.tasks?.middleware).toEqual([taskMw]);
    expect(result?.resources?.middleware).toEqual([resourceMw]);
  });

  it("normalizes conditional subtree middleware entries", () => {
    const taskPredicate = (definition: { id: string }) =>
      definition.id.endsWith(".critical");
    const resourcePredicate = (definition: { id: string }) =>
      definition.id.endsWith(".critical");

    const taskEntry = {
      use: taskMw.with({ role: "critical" }),
      when: taskPredicate,
    };
    const resourceEntry = {
      use: resourceMw.with({ role: "critical" }),
      when: resourcePredicate,
    };

    const result = normalizeResourceSubtreePolicy({
      tasks: { middleware: [taskEntry] },
      resources: { middleware: [resourceEntry] },
    });

    expect(result?.tasks?.middleware).toHaveLength(1);
    expect(result?.resources?.middleware).toHaveLength(1);
    expect(result?.tasks?.middleware?.[0]).toEqual(taskEntry);
    expect(result?.resources?.middleware?.[0]).toEqual(resourceEntry);
    expect(result?.tasks?.middleware?.[0]).not.toBe(taskEntry);
    expect(result?.resources?.middleware?.[0]).not.toBe(resourceEntry);
  });

  it("appends middleware and validators by default", () => {
    const firstValidator = () => [{ code: "custom" as const, message: "1" }];
    const secondValidator = () => [{ code: "custom" as const, message: "2" }];

    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [taskMw],
        },
        validate: [firstValidator],
      },
      {
        tasks: {
          middleware: [taskMw.with({})],
        },
        validate: secondValidator,
      },
    );

    expect(merged.tasks?.middleware).toHaveLength(2);
    expect(merged.validate).toEqual([firstValidator, secondValidator]);
  });

  it("overrides only provided branches", () => {
    const firstValidator = () => [{ code: "custom" as const, message: "a" }];
    const secondValidator = () => [{ code: "custom" as const, message: "b" }];

    const existing = mergeResourceSubtreePolicy(undefined, {
      tasks: {
        middleware: [taskMw],
      },
      resources: {
        middleware: [resourceMw],
      },
      validate: [firstValidator],
    });

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        tasks: {
          middleware: [],
        },
        validate: [secondValidator],
      },
      { override: true },
    );

    expect(merged.tasks?.middleware).toEqual([]);
    expect(merged.resources?.middleware).toEqual([resourceMw]);
    expect(merged.validate).toEqual([secondValidator]);
  });

  it("does not clear validators when override is true and validate is omitted", () => {
    const firstValidator = () => [{ code: "custom" as const, message: "a" }];

    const existing = mergeResourceSubtreePolicy(undefined, {
      validate: [firstValidator],
      tasks: {
        middleware: [taskMw],
      },
    });

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        tasks: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.validate).toEqual([firstValidator]);
    expect(merged.tasks?.middleware).toEqual([]);
  });

  it("normalizes missing middleware arrays to empty arrays", () => {
    const result = normalizeResourceSubtreePolicy({
      tasks: {},
      resources: {},
    });

    expect(result?.tasks?.middleware).toEqual([]);
    expect(result?.resources?.middleware).toEqual([]);
  });

  it("returns a shallow copy when incoming subtree policy is undefined", () => {
    const existing = {
      tasks: {
        middleware: [taskMw],
      },
      validate: [() => []],
    };

    const merged = mergeResourceSubtreePolicy(existing, undefined as any);
    expect(merged).toEqual(existing);
    expect(merged).not.toBe(existing);
  });

  it("returns an empty object when both existing and incoming are undefined", () => {
    expect(mergeResourceSubtreePolicy(undefined, undefined as any)).toEqual({});
  });
});
