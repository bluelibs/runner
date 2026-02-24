import { defineResourceMiddleware, defineTaskMiddleware } from "../../define";
import {
  mergeResourceSubtreePolicy,
  normalizeResourceSubtreePolicy,
} from "../../definers/subtreePolicy";
import { defineEvent, defineHook, defineTag } from "../../define";

describe("subtree policy normalization", () => {
  const taskMw = defineTaskMiddleware({
    id: "tests.subtree.task.mw",
    run: async ({ next }) => next(),
  });
  const resourceMw = defineResourceMiddleware({
    id: "tests.subtree.resource.mw",
    run: async ({ next }) => next(),
  });
  const event = defineEvent({
    id: "tests.subtree.event",
  });
  const hook = defineHook({
    id: "tests.subtree.hook",
    on: event,
    run: async () => undefined,
  });
  const tag = defineTag({
    id: "tests.subtree.tag",
  });

  it("normalizes validator fields to arrays", () => {
    const taskValidator = () => [{ code: "custom" as const, message: "x" }];
    const resourceValidator = () => [{ code: "custom" as const, message: "y" }];
    const hookValidator = () => [{ code: "custom" as const, message: "hook" }];
    const taskMwValidator = () => [
      { code: "custom" as const, message: "task-mw" },
    ];
    const resourceMwValidator = () => [
      { code: "custom" as const, message: "resource-mw" },
    ];
    const eventValidator = () => [
      { code: "custom" as const, message: "event" },
    ];
    const tagValidator = () => [{ code: "custom" as const, message: "tag" }];

    const result = normalizeResourceSubtreePolicy({
      tasks: {
        middleware: [taskMw],
        validate: taskValidator,
      },
      resources: {
        middleware: [resourceMw],
        validate: resourceValidator,
      },
      hooks: {
        validate: hookValidator,
      },
      taskMiddleware: {
        validate: taskMwValidator,
      },
      resourceMiddleware: {
        validate: resourceMwValidator,
      },
      events: {
        validate: eventValidator,
      },
      tags: {
        validate: tagValidator,
      },
    });

    expect(result?.tasks?.validate).toEqual([taskValidator]);
    expect(result?.resources?.validate).toEqual([resourceValidator]);
    expect(result?.hooks?.validate).toEqual([hookValidator]);
    expect(result?.taskMiddleware?.validate).toEqual([taskMwValidator]);
    expect(result?.resourceMiddleware?.validate).toEqual([resourceMwValidator]);
    expect(result?.events?.validate).toEqual([eventValidator]);
    expect(result?.tags?.validate).toEqual([tagValidator]);
  });

  it("appends middleware and validators by default", () => {
    const firstTaskValidator = () => [
      { code: "custom" as const, message: "1" },
    ];
    const secondTaskValidator = () => [
      { code: "custom" as const, message: "2" },
    ];

    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [taskMw],
          validate: [firstTaskValidator],
        },
      },
      {
        tasks: {
          middleware: [taskMw.with({})],
          validate: secondTaskValidator,
        },
      },
    );

    expect(merged.tasks?.middleware).toHaveLength(2);
    expect(merged.tasks?.validate).toEqual([
      firstTaskValidator,
      secondTaskValidator,
    ]);
  });

  it("overrides only provided branches", () => {
    const eventValidatorA = () => [{ code: "custom" as const, message: "a" }];
    const eventValidatorB = () => [{ code: "custom" as const, message: "b" }];

    const existing = mergeResourceSubtreePolicy(undefined, {
      tasks: {
        middleware: [taskMw],
      },
      resources: {
        middleware: [resourceMw],
      },
      hooks: {
        validate: [
          () => [{ code: "custom" as const, message: hook.id }],
          () => [{ code: "custom" as const, message: tag.id }],
        ],
      },
      events: {
        validate: [eventValidatorA],
      },
    });

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        tasks: {
          middleware: [],
          validate: [],
        },
        events: {
          validate: [eventValidatorB],
        },
      },
      { override: true },
    );

    expect(merged.tasks?.middleware).toEqual([]);
    expect(merged.resources?.middleware).toEqual([resourceMw]);
    expect(merged.hooks?.validate).toHaveLength(2);
    expect(merged.events?.validate).toEqual([eventValidatorB]);
  });

  it("normalizes missing middleware arrays to empty arrays", () => {
    const result = normalizeResourceSubtreePolicy({
      tasks: {
        validate: () => [],
      },
      resources: {
        validate: () => [],
      },
    });

    expect(result?.tasks?.middleware).toEqual([]);
    expect(result?.resources?.middleware).toEqual([]);
  });

  it("appends validate-only branches by default", () => {
    const first = () => [{ code: "custom" as const, message: "first" }];
    const second = () => [{ code: "custom" as const, message: "second" }];

    const merged = mergeResourceSubtreePolicy(
      {
        taskMiddleware: { validate: [first] },
        resourceMiddleware: { validate: [first] },
        tags: { validate: [first] },
      },
      {
        taskMiddleware: { validate: [second] },
        resourceMiddleware: { validate: [second] },
        tags: { validate: [second] },
      },
    );

    expect(merged.taskMiddleware?.validate).toEqual([first, second]);
    expect(merged.resourceMiddleware?.validate).toEqual([first, second]);
    expect(merged.tags?.validate).toEqual([first, second]);
  });

  it("returns a shallow copy when incoming subtree policy is undefined", () => {
    const existing = {
      tasks: {
        middleware: [taskMw],
        validate: [() => []],
      },
    };

    const merged = mergeResourceSubtreePolicy(existing, undefined as any);
    expect(merged).toEqual(existing);
    expect(merged).not.toBe(existing);
  });

  it("returns an empty object when both existing and incoming are undefined", () => {
    expect(mergeResourceSubtreePolicy(undefined, undefined as any)).toEqual({});
  });
});
