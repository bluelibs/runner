import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import {
  frameworkNamespaceMetaPolicy,
  validateFrameworkNamespaceMetadata,
} from "../../models/frameworkNamespaceMetaPolicy";

describe("frameworkNamespaceMetaPolicy", () => {
  it.each([
    {
      label: "Task",
      build: () =>
        defineTask({
          id: "framework-meta-policy-task",
          run: async () => "ok",
        }),
    },
    {
      label: "Resource",
      build: () =>
        defineResource({
          id: "framework-meta-policy-resource",
        }),
    },
    {
      label: "Hook",
      build: () => {
        const event = defineEvent({
          id: "framework-meta-policy-hook-event",
        });

        return defineHook({
          id: "framework-meta-policy-hook",
          on: event,
          run: async () => undefined,
        });
      },
    },
    {
      label: "Event",
      build: () =>
        defineEvent({
          id: "framework-meta-policy-event",
        }),
    },
    {
      label: "Tag",
      build: () =>
        defineTag({
          id: "framework-meta-policy-tag",
        }),
    },
    {
      label: "Task middleware",
      build: () =>
        defineTaskMiddleware({
          id: "framework-meta-policy-task-middleware",
          run: async ({ next }) => next(),
        }),
    },
    {
      label: "Resource middleware",
      build: () =>
        defineResourceMiddleware({
          id: "framework-meta-policy-resource-middleware",
          run: async ({ next }) => next(),
        }),
    },
  ])(
    "requires title and description for $label definitions",
    ({ label, build }) => {
      const definition = build();

      expect(validateFrameworkNamespaceMetadata(definition)).toEqual([
        {
          code: "framework-meta-title-required",
          message: `${label} "${definition.id}" must define meta.title.`,
        },
        {
          code: "framework-meta-description-required",
          message: `${label} "${definition.id}" must define meta.description.`,
        },
      ]);
    },
  );

  it("accepts definitions with non-empty metadata", () => {
    const task = defineTask({
      id: "framework-meta-policy-valid-task",
      meta: {
        title: "Valid Framework Task",
        description: "Keeps the metadata validator satisfied.",
      },
      run: async () => "ok",
    });

    expect(validateFrameworkNamespaceMetadata(task)).toEqual([]);
  });

  it("rejects whitespace-only metadata values", () => {
    const task = defineTask({
      id: "framework-meta-policy-whitespace-task",
      meta: {
        title: "   ",
        description: "\n\t",
      },
      run: async () => "ok",
    });

    expect(validateFrameworkNamespaceMetadata(task)).toEqual([
      {
        code: "framework-meta-title-required",
        message:
          'Task "framework-meta-policy-whitespace-task" must define meta.title.',
      },
      {
        code: "framework-meta-description-required",
        message:
          'Task "framework-meta-policy-whitespace-task" must define meta.description.',
      },
    ]);
  });

  it("falls back to a generic label for unknown shapes", () => {
    const unknownDefinition = {
      id: "framework-meta-policy-unknown",
      meta: {},
    } as Parameters<typeof validateFrameworkNamespaceMetadata>[0];

    expect(validateFrameworkNamespaceMetadata(unknownDefinition)).toEqual([
      {
        code: "framework-meta-title-required",
        message:
          'Definition "framework-meta-policy-unknown" must define meta.title.',
      },
      {
        code: "framework-meta-description-required",
        message:
          'Definition "framework-meta-policy-unknown" must define meta.description.',
      },
    ]);
  });

  it("exposes the shared validator through the namespace subtree policy", () => {
    expect(frameworkNamespaceMetaPolicy).toMatchObject({
      validate: [validateFrameworkNamespaceMetadata],
    });
  });
});
