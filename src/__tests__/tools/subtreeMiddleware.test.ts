import {
  defineResource,
  defineResourceMiddleware,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewares,
} from "../../tools/subtreeMiddleware";

describe("subtreeMiddleware tools", () => {
  it("resolves task subtree middleware for always/conditional entries", () => {
    const alwaysMiddleware = defineTaskMiddleware<{ label: string }>({
      id: "tests.tools.subtree.task.always",
      run: async ({ next, task }) => next(task.input),
    });
    const conditionalMiddleware = defineTaskMiddleware({
      id: "tests.tools.subtree.task.conditional",
      run: async ({ next, task }) => next(task.input),
    });

    const targetTask = defineTask({
      id: "tests.tools.subtree.task.target.critical",
      run: async () => "ok",
    });

    const ownerResource = defineResource({
      id: "tests.tools.subtree.task.owner",
      subtree: {
        tasks: {
          middleware: [
            { use: alwaysMiddleware.with({ label: "always" }) },
            {
              use: conditionalMiddleware,
              when: (task) => task.id.endsWith(".critical"),
            },
            {
              use: alwaysMiddleware.with({ label: "never" }),
              when: () => false,
            },
          ],
        },
      },
    });

    const resources = new Map([[ownerResource.id, ownerResource]]);
    const resolved = resolveApplicableSubtreeTaskMiddlewares(
      {
        getOwnerResourceId: (itemId: string) => {
          if (itemId === targetTask.id) {
            return ownerResource.id;
          }
          return undefined;
        },
        getResource: (resourceId: string) => resources.get(resourceId),
      },
      targetTask,
    );

    expect(resolved.map((middleware) => middleware.id)).toEqual([
      alwaysMiddleware.id,
      conditionalMiddleware.id,
    ]);
    expect((resolved[0] as { config: { label: string } }).config.label).toBe(
      "always",
    );
  });

  it("resolves resource subtree middleware for conditional entries", () => {
    const alwaysMiddleware = defineResourceMiddleware<{ label: string }>({
      id: "tests.tools.subtree.resource.always",
      run: async ({ next }) => next(),
    });
    const conditionalMiddleware = defineResourceMiddleware({
      id: "tests.tools.subtree.resource.conditional",
      run: async ({ next }) => next(),
    });

    const targetResource = defineResource({
      id: "tests.tools.subtree.resource.target.critical",
      init: async () => "ok",
    });

    const ownerResource = defineResource({
      id: "tests.tools.subtree.resource.owner",
      subtree: {
        resources: {
          middleware: [
            { use: alwaysMiddleware.with({ label: "always" }) },
            {
              use: conditionalMiddleware,
              when: (resource) => resource.id.endsWith(".critical"),
            },
          ],
        },
      },
    });

    const resources = new Map([
      [ownerResource.id, ownerResource],
      [targetResource.id, targetResource],
    ]);
    const resolved = resolveApplicableSubtreeResourceMiddlewares(
      {
        getOwnerResourceId: (itemId: string) => {
          if (itemId === ownerResource.id) {
            return undefined;
          }
          return ownerResource.id;
        },
        getResource: (resourceId: string) => resources.get(resourceId),
      },
      targetResource,
    );

    expect(resolved.map((middleware) => middleware.id)).toEqual([
      alwaysMiddleware.id,
      conditionalMiddleware.id,
    ]);
  });

  it("fails fast when duplicate middleware ids are applicable", () => {
    const middleware = defineTaskMiddleware<{ label: string }>({
      id: "tests.tools.subtree.duplicate.middleware",
      run: async ({ next, task }) => next(task.input),
    });
    const targetTask = defineTask({
      id: "tests.tools.subtree.duplicate.target",
      run: async () => "ok",
    });

    const ownerResource = defineResource({
      id: "tests.tools.subtree.duplicate.owner",
      subtree: {
        tasks: {
          middleware: [
            { use: middleware.with({ label: "first" }), when: () => true },
            { use: middleware.with({ label: "second" }), when: () => true },
          ],
        },
      },
    });

    expect(() =>
      resolveApplicableSubtreeTaskMiddlewares(
        {
          getOwnerResourceId: (itemId: string) => {
            if (itemId === targetTask.id) {
              return ownerResource.id;
            }
            return undefined;
          },
          getResource: (resourceId: string) => {
            if (resourceId === ownerResource.id) {
              return ownerResource;
            }
            return undefined;
          },
        },
        targetTask,
      ),
    ).toThrow(/Duplicate middleware id/);
  });

  it("unwraps direct and conditional subtree middleware entries", () => {
    const taskMiddleware = defineTaskMiddleware({
      id: "tests.tools.subtree.unwrap.task",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "tests.tools.subtree.unwrap.resource",
      run: async ({ next }) => next(),
    });

    expect(getSubtreeTaskMiddlewareAttachment(taskMiddleware)).toBe(
      taskMiddleware,
    );
    expect(
      getSubtreeTaskMiddlewareAttachment({
        use: taskMiddleware,
        when: () => true,
      }),
    ).toBe(taskMiddleware);

    expect(getSubtreeResourceMiddlewareAttachment(resourceMiddleware)).toBe(
      resourceMiddleware,
    );
    expect(
      getSubtreeResourceMiddlewareAttachment({
        use: resourceMiddleware,
        when: () => true,
      }),
    ).toBe(resourceMiddleware);
  });

  it("throws for invalid subtree attachment entries", () => {
    expect(() =>
      getSubtreeTaskMiddlewareAttachment({ nope: true } as any),
    ).toThrow(/Invalid subtree task middleware entry/);

    expect(() =>
      getSubtreeResourceMiddlewareAttachment({ nope: true } as any),
    ).toThrow(/Invalid subtree resource middleware entry/);
  });

  it("fails fast on invalid conditional-shaped entries when resolving middleware lists", () => {
    const taskMiddleware = defineTaskMiddleware({
      id: "tests.tools.subtree.invalid-entry.task.middleware",
      run: async ({ next, task }) => next(task.input),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "tests.tools.subtree.invalid-entry.resource.middleware",
      run: async ({ next }) => next(),
    });

    const targetTask = defineTask({
      id: "tests.tools.subtree.invalid-entry.task.target",
      run: async () => "ok",
    });
    const targetResource = defineResource({
      id: "tests.tools.subtree.invalid-entry.resource.target",
      init: async () => "ok",
    });

    const ownerResource = defineResource({
      id: "tests.tools.subtree.invalid-entry.owner",
      subtree: {
        tasks: {
          middleware: [{ nope: true } as any, taskMiddleware],
        },
        resources: {
          middleware: [{ nope: true } as any, resourceMiddleware],
        },
      },
    });

    const resources = new Map([
      [ownerResource.id, ownerResource],
      [targetResource.id, targetResource],
    ]);

    expect(() =>
      resolveApplicableSubtreeTaskMiddlewares(
        {
          getOwnerResourceId: (itemId: string) => {
            if (itemId === targetTask.id) {
              return ownerResource.id;
            }
            return undefined;
          },
          getResource: (resourceId: string) => resources.get(resourceId),
        },
        targetTask,
      ),
    ).toThrow(/Invalid subtree task middleware entry/);

    expect(() =>
      resolveApplicableSubtreeResourceMiddlewares(
        {
          getOwnerResourceId: (itemId: string) => {
            if (itemId === ownerResource.id) {
              return undefined;
            }
            return ownerResource.id;
          },
          getResource: (resourceId: string) => resources.get(resourceId),
        },
        targetResource,
      ),
    ).toThrow(/Invalid subtree resource middleware entry/);
  });
});
