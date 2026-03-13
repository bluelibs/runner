import {
  createDisplaySubtreePolicy,
  mergeResourceSubtreeDeclarations,
  mergeResourceSubtreePolicy,
  normalizeResourceSubtreePolicy,
  resolveResourceSubtreeDeclarations,
} from "../../definers/subtreePolicy";
import { r } from "../..";
import { RunnerMode } from "../../types/runner";

describe("mergeResourceSubtreePolicy", () => {
  it("appends resources subtree entries when override is disabled", () => {
    const middlewareA = r.middleware
      .resource("tests-subtree-merge-resource-middleware-a")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const middlewareB = r.middleware
      .resource("tests-subtree-merge-resource-middleware-b")
      .run(async ({ next, resource }) => next(resource.config))
      .build();
    const validateA = jest.fn(() => []);
    const validateB = jest.fn(() => []);

    const existing = {
      resources: {
        middleware: [{ use: middlewareA }],
      },
      validate: [validateA],
    } as any;

    const merged = mergeResourceSubtreePolicy(
      existing,
      {
        resources: {
          middleware: [{ use: middlewareB }],
        },
        validate: [validateB],
      },
      { override: false },
    );

    expect(merged.resources?.middleware).toEqual([
      { use: middlewareA, when: undefined },
      { use: middlewareB, when: undefined },
    ]);
    expect(merged.validate).toEqual([validateA, validateB]);
    expect(existing.resources.middleware).toEqual([{ use: middlewareA }]);
    expect(existing.validate).toEqual([validateA]);
  });

  it("keeps existing validators when incoming policy omits validate", () => {
    const validateA = jest.fn(() => []);

    const merged = mergeResourceSubtreePolicy(
      { validate: [validateA] },
      {
        resources: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.validate).toEqual([validateA]);
  });

  it("normalizes explicit undefined validate entries into an empty array", () => {
    expect(
      normalizeResourceSubtreePolicy({
        validate: undefined,
      }),
    ).toEqual({ validate: [] });

    expect(
      mergeResourceSubtreePolicy(
        {
          validate: undefined,
        } as any,
        {},
      ),
    ).toEqual({ validate: [] });
  });

  it("clones policies without validate markers and keeps existing validators when incoming validate is undefined", () => {
    const validateA = jest.fn(() => []);
    const validateB = jest.fn(() => []);

    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
          },
        },
        {},
      ),
    ).toEqual({
      tasks: {
        middleware: [],
      },
    });

    expect(
      mergeResourceSubtreePolicy(
        { validate: [validateA] },
        {
          validate: undefined,
        },
      ),
    ).toEqual({
      tasks: undefined,
      resources: undefined,
      validate: [validateA],
    });

    expect(
      mergeResourceSubtreePolicy(
        { validate: [validateA] },
        {
          validate: [validateB],
        },
        { override: true },
      ),
    ).toEqual({
      tasks: undefined,
      resources: undefined,
      validate: [validateB],
    });
  });

  it("normalizes typed validator branches", () => {
    const taskValidator = jest.fn(() => []);
    const taskMiddlewareValidator = jest.fn(() => []);

    const result = normalizeResourceSubtreePolicy({
      tasks: {
        middleware: [],
        validate: taskValidator,
      },
      taskMiddleware: {
        validate: taskMiddlewareValidator,
      },
    });

    expect(result?.tasks).toEqual({
      middleware: [],
      validate: [taskValidator],
    });
    expect(result?.taskMiddleware).toEqual({
      validate: [taskMiddlewareValidator],
    });
  });

  it("normalizes empty typed validator branches", () => {
    const result = normalizeResourceSubtreePolicy({
      hooks: {},
      events: {},
      tags: {},
      taskMiddleware: {},
      resourceMiddleware: {},
    });

    expect(result).toEqual({
      hooks: {},
      events: {},
      tags: {},
      taskMiddleware: {},
      resourceMiddleware: {},
    });
  });

  it("appends typed validators and keeps other branches when overriding", () => {
    const firstTaskValidator = jest.fn(() => []);
    const secondTaskValidator = jest.fn(() => []);
    const eventValidator = jest.fn(() => []);

    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          validate: [firstTaskValidator],
        },
        events: {
          validate: [eventValidator],
        },
      },
      {
        tasks: {
          middleware: [],
          validate: [secondTaskValidator],
        },
      },
      { override: false },
    );

    expect(merged.tasks?.validate).toEqual([
      firstTaskValidator,
      secondTaskValidator,
    ]);
    expect(merged.events?.validate).toEqual([eventValidator]);

    const overridden = mergeResourceSubtreePolicy(
      merged,
      {
        taskMiddleware: {
          validate: [],
        },
      },
      { override: true },
    );

    expect(overridden.tasks?.validate).toEqual([
      firstTaskValidator,
      secondTaskValidator,
    ]);
    expect(overridden.taskMiddleware?.validate).toEqual([]);
  });

  it("resolves mixed static and dynamic subtree declarations in call order", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    const declarations = mergeResourceSubtreeDeclarations(
      undefined,
      {
        validate: [firstValidator],
      },
      { override: false },
    );
    const mergedDeclarations = mergeResourceSubtreeDeclarations(
      declarations,
      (config: { enabled: boolean }) => ({
        tasks: {
          middleware: [],
          validate: config.enabled ? [secondValidator] : [],
        },
      }),
      { override: false },
    );

    expect(
      resolveResourceSubtreeDeclarations(
        mergedDeclarations,
        {
          enabled: true,
        },
        RunnerMode.TEST,
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [secondValidator],
      },
      validate: [firstValidator],
    });
    expect(
      resolveResourceSubtreeDeclarations(
        mergedDeclarations,
        {
          enabled: false,
        },
        RunnerMode.TEST,
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      validate: [firstValidator],
    });
  });

  it("clones typed validator branches when incoming policy is undefined", () => {
    const hookValidator = jest.fn(() => []);

    expect(
      mergeResourceSubtreePolicy(
        {
          hooks: {
            validate: [hookValidator],
          },
        },
        undefined as any,
      ),
    ).toEqual({
      hooks: {
        validate: [hookValidator],
      },
      tasks: undefined,
      resources: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("preserves existing typed validators when incoming branch omits validate", () => {
    const existingValidator = jest.fn(() => []);

    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
            validate: [existingValidator],
          },
        },
        {
          tasks: {
            middleware: [],
          },
        },
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [existingValidator],
      },
      resources: undefined,
      hooks: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("creates display policies for both static and dynamic declarations", () => {
    const staticDisplay = createDisplaySubtreePolicy([
      {
        policy: {
          hooks: {},
        },
      },
    ]);

    expect(staticDisplay).toEqual({
      hooks: {},
    });
    expect(createDisplaySubtreePolicy(undefined)).toBeUndefined();

    const dynamicDisplay = createDisplaySubtreePolicy([
      {
        policy: (config: { enabled: boolean }) => ({
          validate: config.enabled ? [() => []] : [],
        }),
      },
    ]);

    expect(typeof dynamicDisplay).toBe("function");
    if (typeof dynamicDisplay !== "function") {
      return;
    }

    expect(dynamicDisplay({ enabled: true }, RunnerMode.TEST)).toEqual({
      validate: [expect.any(Function)],
    });
    expect(dynamicDisplay({ enabled: false }, RunnerMode.TEST)).toEqual({
      validate: [],
    });
  });

  it("merges resource middleware branches with typed validators", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    const initial = mergeResourceSubtreePolicy(undefined, {
      resources: {
        middleware: [],
        validate: [firstValidator],
      },
    });
    const merged = mergeResourceSubtreePolicy(initial, {
      resources: {
        middleware: [],
        validate: [secondValidator],
      },
    });
    const preserved = mergeResourceSubtreePolicy(merged, {
      resources: {
        middleware: [],
      },
    });

    expect(initial.resources?.validate).toEqual([firstValidator]);
    expect(merged.resources?.validate).toEqual([
      firstValidator,
      secondValidator,
    ]);
    expect(preserved.resources?.validate).toEqual([
      firstValidator,
      secondValidator,
    ]);
  });

  it("handles typed-only validator branch overrides and omissions", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    expect(
      mergeResourceSubtreePolicy(
        {
          hooks: {
            validate: [firstValidator],
          },
        },
        {
          hooks: {
            validate: [secondValidator],
          },
        },
      ),
    ).toEqual({
      hooks: {
        validate: [firstValidator, secondValidator],
      },
      tasks: undefined,
      resources: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });

    expect(
      mergeResourceSubtreePolicy(
        {
          hooks: {
            validate: [firstValidator],
          },
        },
        {
          hooks: {},
        },
      ),
    ).toEqual({
      hooks: {
        validate: [firstValidator],
      },
      tasks: undefined,
      resources: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });

    expect(
      mergeResourceSubtreePolicy(
        {
          hooks: {
            validate: [firstValidator],
          },
        },
        {
          hooks: {},
        },
        { override: true },
      ),
    ).toEqual({
      hooks: {},
      tasks: undefined,
      resources: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("clones branches without validate markers", () => {
    expect(
      mergeResourceSubtreePolicy(
        {
          resources: {
            middleware: [],
          },
          hooks: {},
        },
        undefined as any,
      ),
    ).toEqual({
      tasks: undefined,
      resources: {
        middleware: [],
      },
      hooks: {},
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("handles explicit undefined validator markers across clone and merge paths", () => {
    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
            validate: undefined,
          },
          hooks: {
            validate: undefined,
          },
        },
        undefined as any,
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      resources: undefined,
      hooks: {
        validate: [],
      },
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });

    expect(
      mergeResourceSubtreePolicy(undefined, {
        tasks: {
          middleware: [],
          validate: undefined,
        },
        hooks: {
          validate: undefined,
        },
      }),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      hooks: {
        validate: [],
      },
    });

    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
            validate: undefined,
          },
          hooks: {
            validate: undefined,
          },
        },
        {
          tasks: {
            middleware: [],
            validate: undefined,
          },
          hooks: {
            validate: undefined,
          },
        },
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      resources: undefined,
      hooks: {
        validate: [],
      },
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });

    expect(
      mergeResourceSubtreePolicy(
        {
          tasks: {
            middleware: [],
            validate: undefined,
          },
          hooks: {
            validate: undefined,
          },
        },
        {
          tasks: {
            middleware: [],
          },
          hooks: {},
        },
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      resources: undefined,
      hooks: {
        validate: [],
      },
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("returns an empty object from dynamic display policies when resolution is undefined", () => {
    const dynamicDisplay = createDisplaySubtreePolicy([
      {
        policy: (() => undefined) as any,
      },
    ]);

    expect(typeof dynamicDisplay).toBe("function");
    if (typeof dynamicDisplay !== "function") {
      return;
    }

    expect(dynamicDisplay({}, RunnerMode.TEST)).toEqual({});
  });

  it("keeps empty typed-only branches empty when both sides omit validate", () => {
    expect(
      mergeResourceSubtreePolicy(
        {
          hooks: {},
        },
        {
          hooks: {},
        },
      ),
    ).toEqual({
      hooks: {},
      tasks: undefined,
      resources: undefined,
      events: undefined,
      tags: undefined,
      taskMiddleware: undefined,
      resourceMiddleware: undefined,
    });
  });

  it("returns resolved policies from dynamic display callbacks", () => {
    const dynamicDisplay = createDisplaySubtreePolicy([
      {
        policy: (config: { enabled: boolean }) => ({
          hooks: config.enabled
            ? {
                validate: [() => []],
              }
            : {},
        }),
      },
    ]);

    expect(typeof dynamicDisplay).toBe("function");
    if (typeof dynamicDisplay !== "function") {
      return;
    }

    expect(dynamicDisplay({ enabled: true }, RunnerMode.TEST)).toEqual({
      hooks: {
        validate: [expect.any(Function)],
      },
    });
  });

  it("treats a static policy array like sequential subtree declarations", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    const declarations = mergeResourceSubtreeDeclarations(undefined, [
      {
        validate: [firstValidator],
      },
      {
        hooks: {
          validate: [secondValidator],
        },
      },
    ]);

    expect(
      resolveResourceSubtreeDeclarations(declarations, {}, RunnerMode.TEST),
    ).toEqual({
      hooks: {
        validate: [secondValidator],
      },
      validate: [firstValidator],
    });
    expect(createDisplaySubtreePolicy(declarations)).toEqual({
      hooks: {
        validate: [secondValidator],
      },
      validate: [firstValidator],
    });
  });

  it("applies override semantics to every policy in a static array", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    const declarations = mergeResourceSubtreeDeclarations(
      mergeResourceSubtreeDeclarations(undefined, {
        validate: [firstValidator],
      }),
      [
        {
          hooks: {},
        },
        {
          validate: [secondValidator],
        },
      ],
      { override: true },
    );

    expect(
      resolveResourceSubtreeDeclarations(declarations, {}, RunnerMode.TEST),
    ).toEqual({
      hooks: {},
      validate: [secondValidator],
    });
  });

  it("resolves config-driven policy arrays in declaration order", () => {
    const firstValidator = jest.fn(() => []);
    const secondValidator = jest.fn(() => []);

    const declarations = mergeResourceSubtreeDeclarations(
      undefined,
      (config: { enabled: boolean }) => [
        {
          validate: [firstValidator],
        },
        {
          tasks: {
            middleware: [],
            validate: config.enabled ? [secondValidator] : [],
          },
        },
      ],
    );

    expect(
      resolveResourceSubtreeDeclarations(
        declarations,
        { enabled: true },
        RunnerMode.TEST,
      ),
    ).toEqual({
      tasks: {
        middleware: [],
        validate: [secondValidator],
      },
      validate: [firstValidator],
    });

    const display = createDisplaySubtreePolicy(declarations);
    expect(typeof display).toBe("function");
    if (typeof display !== "function") {
      return;
    }

    expect(display({ enabled: false }, RunnerMode.TEST)).toEqual({
      tasks: {
        middleware: [],
        validate: [],
      },
      validate: [firstValidator],
    });
  });

  it("accepts empty subtree policy arrays without throwing", () => {
    const declarations = mergeResourceSubtreeDeclarations(undefined, []);

    expect(
      resolveResourceSubtreeDeclarations(declarations, {}, RunnerMode.TEST),
    ).toEqual({});
    expect(createDisplaySubtreePolicy(declarations)).toEqual({});
  });
});
