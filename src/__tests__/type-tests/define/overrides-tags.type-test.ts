import {
  defineOverride,
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";

// Type-only tests for define overrides and tags.

// Scenario: overrides should enforce compatible implementations.
{
  const task = defineTask({
    id: "task",
    run: async () => "Task executed",
  });

  defineOverride(task, {
    // @ts-expect-error
    run: async () => 234,
  });

  const resource = defineResource({
    id: "resource",
    register: [task],
    init: async () => "Resource executed",
  });

  defineOverride(resource, {
    init: async () => "Resource overridden",
  });

  defineOverride(resource, {
    // @ts-expect-error
    init: async () => 123,
  });

  defineTaskMiddleware({
    id: "middleware",
    run: async () => "Middleware executed",
  });
}

// Scenario: tag usage should enforce payload contracts and task tag compatibility.
{
  const tag = defineTag({ id: "tag" });
  const tag2 = defineTag<{ value: number }>({ id: "tag2" });
  const tag2optional = defineTag<{ value?: number }>({ id: "tag2" });
  const tag3 = tag2.with({ value: 123 });

  // @ts-expect-error
  tag.with({ value: 123 });

  defineTask({
    id: "task",
    tags: [
      tag,
      // @ts-expect-error
      tag2,
      tag2optional,
      tag2.with({ value: 123 }),
      // @ts-expect-error
      tag2.with({ value: "123" }),
      tag3,
    ],
    meta: {},
    run: async (input) => {
      return input;
    },
  });
}
