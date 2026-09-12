import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { defineAsyncContext } from "../../definers/defineAsyncContext";
import { defineError } from "../../definers/defineError";
import { defineOverride } from "../../definers/defineOverride";
import { runtimeInspectionTargetNotFoundError } from "../../errors";
import { run } from "../../run";

describe("RuntimeInspector", () => {
  it("returns a stable immutable graph and explains compiled definitions", async () => {
    const visibleTag = defineTag({ id: "visible" });
    const startupTag = defineTag({ id: "startup" });
    const auditMiddleware = defineTaskMiddleware({
      id: "audit",
      run: async ({ next }) => next(),
    });
    const authorizeMiddleware = defineTaskMiddleware({
      id: "authorize",
      run: async ({ next }) => next(),
    });
    const inheritedMiddleware = defineTaskMiddleware({
      id: "inherited",
      run: async ({ next }) => next(),
    });
    const resourceMiddleware = defineResourceMiddleware({
      id: "resource-audit",
      run: async ({ next }) => next(),
    });
    const inheritedResourceMiddleware = defineResourceMiddleware({
      id: "inherited-resource",
      run: async ({ next }) => next(),
    });
    const database = defineResource<{ url: string }>({
      id: "database",
      init: async (config) => config.url,
    });
    const missingDatabase = defineResource({ id: "missing-database" });
    const configuredDatabase = database.with({ url: "memory://test" });
    const userCreated = defineEvent<{ userId: string }>({
      id: "user-created",
    });
    const createUser = defineTask({
      id: "create-user",
      dependencies: () => ({
        database,
        optionalDatabase: database.optional(),
        missingDatabase: missingDatabase.optional(),
        visibleAtStartup: startupTag.startup(),
        userCreated,
      }),
      middleware: [auditMiddleware, authorizeMiddleware],
      tags: [visibleTag],
      run: async () => "created",
    });
    const hiddenTask = defineTask({
      id: "hidden-task",
      run: async () => "hidden",
    });
    const hiddenTaskOverride = defineOverride(
      hiddenTask,
      async () => "overridden",
    );
    const userCreatedHook = defineHook({
      id: "observe-user-created",
      on: userCreated,
      dependencies: { database },
      run: async () => undefined,
    });
    const managedResource = defineResource({
      id: "managed",
      middleware: [resourceMiddleware],
      init: async () => "managed",
    });
    const requestContext = defineAsyncContext<string>({ id: "request" });
    const deniedError = defineError({ id: "denied" });
    const app = defineResource({
      id: "app",
      register: [
        visibleTag,
        startupTag,
        auditMiddleware,
        authorizeMiddleware,
        inheritedMiddleware,
        resourceMiddleware,
        inheritedResourceMiddleware,
        configuredDatabase,
        userCreated,
        createUser,
        hiddenTask,
        userCreatedHook,
        managedResource,
        requestContext,
        deniedError,
      ],
      subtree: {
        tasks: { middleware: [inheritedMiddleware] },
        resources: { middleware: [inheritedResourceMiddleware] },
      },
      overrides: [hiddenTaskOverride],
      isolate: { exports: [createUser] },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const inspector = runtime.inspect();
    const snapshot = inspector.snapshot();

    expect(runtime.inspect()).toBe(inspector);
    expect(inspector.snapshot()).toBe(snapshot);
    expect(Object.getOwnPropertyNames(inspector)).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.definitions)).toBe(true);
    expect(Reflect.set(snapshot, "rootId", "mutated")).toBe(false);
    expect(Reflect.set(snapshot.definitions, "0", null)).toBe(false);
    expect(snapshot.rootId).toBe("app");
    expect(snapshot.definitions.map(({ canonicalId }) => canonicalId)).toEqual(
      [...snapshot.definitions]
        .map(({ canonicalId }) => canonicalId)
        .sort((left, right) => left.localeCompare(right)),
    );

    const taskExplanation = inspector.explain(createUser);
    expect(taskExplanation).toEqual({
      kind: "task",
      canonicalId: "app.tasks.create-user",
      sourceId: "create-user",
      ownerId: "app",
      dependenciesResolved: true,
      dependencies: [
        { key: "database", id: "app.database" },
        { key: "optionalDatabase", id: "app.database" },
        { key: "visibleAtStartup", id: "app.tags.startup" },
        { key: "userCreated", id: "app.events.user-created" },
      ],
      middleware: [
        {
          id: "app.middleware.task.inherited",
          order: 0,
          origin: "subtree",
          sourceId: "app",
        },
        {
          id: "app.middleware.task.audit",
          order: 1,
          origin: "local",
          sourceId: "app.tasks.create-user",
        },
        {
          id: "app.middleware.task.authorize",
          order: 2,
          origin: "local",
          sourceId: "app.tasks.create-user",
        },
      ],
      tagIds: ["app.tags.visible"],
      override: undefined,
      rootAccess: {
        accessible: true,
        exportsDeclared: true,
        directlyExported: true,
      },
    });
    expect(Object.isFrozen(taskExplanation.dependencies)).toBe(true);
    expect(inspector.explain("app.tasks.create-user")).toBe(taskExplanation);

    expect(inspector.explain(configuredDatabase)).toMatchObject({
      kind: "resource",
      canonicalId: "app.database",
      sourceId: "database",
      ownerId: "app",
    });
    expect(inspector.explain(managedResource).middleware).toEqual([
      {
        id: "app.middleware.resource.inherited-resource",
        order: 0,
        origin: "subtree",
        sourceId: "app",
      },
      {
        id: "app.middleware.resource.resource-audit",
        order: 1,
        origin: "local",
        sourceId: "app.managed",
      },
    ]);
    expect(inspector.explain(hiddenTask).rootAccess).toEqual({
      accessible: false,
      exportsDeclared: true,
      directlyExported: false,
    });
    expect(inspector.explain(hiddenTask).override).toEqual({
      baseCanonicalId: "app.tasks.hidden-task",
      baseSourceId: "hidden-task",
      winnerSourceId: "hidden-task",
      declaredByResourceId: "app",
    });
    expect(new Set(snapshot.definitions.map(({ kind }) => kind))).toEqual(
      new Set([
        "resource",
        "task",
        "event",
        "hook",
        "taskMiddleware",
        "resourceMiddleware",
        "tag",
        "asyncContext",
        "error",
      ]),
    );

    await runtime.dispose();
  });

  it("throws a typed Runner error for unknown targets", async () => {
    const app = defineResource({ id: "app" });
    const runtime = await run(app, { shutdownHooks: false });

    expect.assertions(5);
    try {
      runtime.inspect().explain("app.tasks.missing");
    } catch (error) {
      expect(runtimeInspectionTargetNotFoundError.is(error)).toBe(true);
      expect(error).toMatchObject({
        id: "runtimeInspectionTargetNotFound",
        data: { targetId: "app.tasks.missing" },
      });
      expect(String(error)).toContain(
        'Runtime inspection target "app.tasks.missing" was not found.',
      );
    }

    expect(() =>
      runtime
        .inspect()
        .explain(defineTask({ id: "missing", run: async () => 1 })),
    ).toThrow('Runtime inspection target "missing" was not found.');

    expect(() =>
      Reflect.apply(runtime.inspect().explain, runtime.inspect(), [null]),
    ).toThrow('Runtime inspection target "<unknown>" was not found.');

    await runtime.dispose();
  });
});
