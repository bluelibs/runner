import { defineResourceMiddleware, defineTaskMiddleware } from "../../define";
import {
  mergeResourceSubtreePolicy,
  normalizeResourceSubtreePolicy,
} from "../../definers/subtreePolicy";
const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;
const roleGate = { roles: ["ADMIN"] } as const;

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

  it("normalizes middleware.identityScope when provided", () => {
    const result = normalizeResourceSubtreePolicy({
      middleware: {
        identityScope: userScope,
      },
    });

    expect(result?.middleware?.identityScope).toEqual(userScope);
    expect(result?.tasks).toBeUndefined();
  });

  it("normalizes tasks.identity when provided", () => {
    const result = normalizeResourceSubtreePolicy({
      tasks: {
        identity: { user: true, roles: ["ADMIN", "CUSTOMER"] },
      },
    });

    expect(result?.tasks?.identity).toEqual([
      {
        tenant: true,
        user: true,
        roles: ["ADMIN", "CUSTOMER"],
      },
    ]);
  });

  it("normalizes an empty middleware policy branch", () => {
    const result = normalizeResourceSubtreePolicy({
      middleware: {},
    });

    expect(result?.middleware).toEqual({});
  });

  it("creates an empty middleware policy branch when merging an empty incoming branch", () => {
    const merged = mergeResourceSubtreePolicy(undefined, {
      middleware: {},
    });

    expect(merged.middleware).toEqual({});
  });

  it("overrides resource middleware without validators when neither side declares validate", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        resources: {
          middleware: [resourceMw],
        },
      },
      {
        resources: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.resources?.middleware).toEqual([]);
    expect(merged.resources?.validate).toBeUndefined();
  });

  it("keeps existing middleware.identityScope when incoming branch omits it", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {
          identityScope: userScope,
        },
      },
      {
        tasks: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.middleware?.identityScope).toEqual(userScope);
  });

  it("keeps existing middleware.identityScope when the incoming middleware branch is empty", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {
          identityScope: userScope,
        },
      },
      {
        middleware: {},
      },
      { override: true },
    );

    expect(merged.middleware?.identityScope).toEqual(userScope);
  });

  it("keeps an existing empty middleware branch when override receives another empty middleware branch", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {},
      },
      {
        middleware: {},
      },
      { override: true },
    );

    expect(merged.middleware).toEqual({});
  });

  it("accepts additive middleware.identityScope declarations that match after normalization", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {
          identityScope: tenantScope,
        },
      },
      {
        middleware: {
          identityScope: { tenant: true, required: true },
        },
      },
    );

    expect(merged.middleware?.identityScope).toEqual(tenantScope);
  });

  it("rejects additive middleware.identityScope declarations that do not match", () => {
    expect(() =>
      mergeResourceSubtreePolicy(
        {
          middleware: {
            identityScope: tenantScope,
          },
        },
        {
          middleware: {
            identityScope: userScope,
          },
        },
      ),
    ).toThrow(/middleware\.identityScope/i);
  });

  it("rejects invalid middleware.identityScope values", () => {
    expect(() =>
      normalizeResourceSubtreePolicy({
        middleware: {
          identityScope: [] as never,
        },
      }),
    ).toThrow(/middleware\.identityScope/i);

    expect(() =>
      normalizeResourceSubtreePolicy({
        middleware: {
          identityScope: { tenant: true, required: "yes" } as never,
        },
      }),
    ).toThrow(/middleware\.identityScope/i);

    expect(() =>
      normalizeResourceSubtreePolicy({
        middleware: {
          identityScope: { tenant: true, bogus: true } as never,
        },
      }),
    ).toThrow(/middleware\.identityScope/i);
  });

  it("rejects invalid tasks.identity values", () => {
    expect(() =>
      normalizeResourceSubtreePolicy({
        tasks: {
          identity: [] as never,
        },
      }),
    ).toThrow(/tasks\.identity/i);

    expect(() =>
      normalizeResourceSubtreePolicy({
        tasks: {
          identity: { roles: [1] } as never,
        },
      }),
    ).toThrow(/tasks\.identity/i);

    expect(() =>
      normalizeResourceSubtreePolicy({
        tasks: {
          identity: { tenant: false } as never,
        },
      }),
    ).toThrow(/tasks\.identity/i);
  });

  it("keeps existing middleware identityScope when override omits it", () => {
    const taskValidator = () => [{ code: "custom" as const, message: "kept" }];

    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [taskMw],
          validate: [taskValidator],
        },
        middleware: {
          identityScope: tenantScope,
        },
      },
      {
        tasks: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.middleware?.identityScope).toEqual(tenantScope);
    expect(merged.tasks?.validate).toEqual([taskValidator]);
  });

  it("replaces middleware identityScope and task validators when override provides them", () => {
    const firstValidator = () => [
      { code: "custom" as const, message: "first" },
    ];
    const secondValidator = () => [
      { code: "custom" as const, message: "second" },
    ];

    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [taskMw],
          validate: [firstValidator],
        },
        middleware: {
          identityScope: tenantScope,
        },
      },
      {
        tasks: {
          middleware: [],
          validate: [secondValidator],
        },
        middleware: {
          identityScope: userScope,
        },
      },
      { override: true },
    );

    expect(merged.middleware?.identityScope).toEqual(userScope);
    expect(merged.tasks?.validate).toEqual([secondValidator]);
  });

  it("keeps existing middleware.identityScope on additive merges when incoming omits it", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [taskMw],
        },
        middleware: {
          identityScope: tenantScope,
        },
      },
      {
        tasks: {
          middleware: [taskMw.with({})],
        },
      },
    );

    expect(merged.middleware?.identityScope).toEqual(tenantScope);
  });

  it("keeps existing middleware.identityScope on additive merges when the incoming middleware branch is empty", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {
          identityScope: tenantScope,
        },
      },
      {
        middleware: {},
      },
    );

    expect(merged.middleware?.identityScope).toEqual(tenantScope);
  });

  it("keeps an existing empty middleware branch on additive merges when the incoming middleware branch is empty", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {},
      },
      {
        middleware: {},
      },
    );

    expect(merged.middleware).toEqual({});
  });

  it("fills an existing empty middleware branch when an additive merge provides identityScope", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {},
      },
      {
        middleware: {
          identityScope: tenantScope,
        },
      },
    );

    expect(merged.middleware?.identityScope).toEqual(tenantScope);
  });

  it("preserves an existing empty middleware branch when other subtree branches are merged", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        middleware: {},
      },
      {
        tasks: {
          middleware: [taskMw],
        },
      },
    );

    expect(merged.middleware).toEqual({});
    expect(merged.tasks?.middleware).toEqual([taskMw]);
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

  it("appends tasks.identity additively by default", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          identity: [roleGate],
        },
      },
      {
        tasks: {
          identity: { user: true },
        },
      },
    );

    expect(merged.tasks?.identity).toEqual([
      { roles: ["ADMIN"] },
      { tenant: true, user: true, roles: [] },
    ]);
  });

  it("adds incoming tasks.identity when the existing branch had none", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
        },
      },
      {
        tasks: {
          identity: { roles: ["ADMIN"] },
        },
      },
    );

    expect(merged.tasks?.identity).toEqual([
      { tenant: true, user: false, roles: ["ADMIN"] },
    ]);
  });

  it("appends existing and incoming tasks.identity arrays on additive merges", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          identity: [{ tenant: true, user: false, roles: ["ADMIN"] }],
        },
      },
      {
        tasks: {
          identity: { roles: ["SUPPORT"] },
        },
      },
    );

    expect(merged.tasks?.identity).toEqual([
      { tenant: true, user: false, roles: ["ADMIN"] },
      { tenant: true, user: false, roles: ["SUPPORT"] },
    ]);
  });

  it("replaces tasks.identity when override provides one", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          identity: [roleGate],
        },
      },
      {
        tasks: {
          identity: { roles: ["CUSTOMER"] },
        },
      },
      { override: true },
    );

    expect(merged.tasks?.identity).toEqual([
      { tenant: true, user: false, roles: ["CUSTOMER"] },
    ]);
  });

  it("keeps tasks.identity when override omits it", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          identity: [roleGate],
        },
      },
      {
        tasks: {
          middleware: [taskMw],
        },
      },
      { override: true },
    );

    expect(merged.tasks?.identity).toEqual([{ roles: ["ADMIN"] }]);
  });

  it("keeps tasks.identity on additive merges when the incoming branch omits it", () => {
    const merged = mergeResourceSubtreePolicy(
      {
        tasks: {
          middleware: [],
          identity: [{ tenant: true, user: false, roles: ["ADMIN"] }],
        },
      },
      {
        tasks: {
          middleware: [taskMw],
        },
      },
    );

    expect(merged.tasks?.identity).toEqual([
      { tenant: true, user: false, roles: ["ADMIN"] },
    ]);
  });

  it("preserves existing resource validators on override when incoming validate is omitted", () => {
    const resourceValidator = () => [
      { code: "custom" as const, message: "resource" },
    ];

    const merged = mergeResourceSubtreePolicy(
      {
        resources: {
          middleware: [resourceMw],
          validate: [resourceValidator],
        },
      },
      {
        resources: {
          middleware: [],
        },
      },
      { override: true },
    );

    expect(merged.resources?.middleware).toEqual([]);
    expect(merged.resources?.validate).toEqual([resourceValidator]);
  });

  it("replaces resource validators on override when incoming validate is provided", () => {
    const firstValidator = () => [
      { code: "custom" as const, message: "first" },
    ];
    const secondValidator = () => [
      { code: "custom" as const, message: "second" },
    ];

    const merged = mergeResourceSubtreePolicy(
      {
        resources: {
          middleware: [resourceMw],
          validate: [firstValidator],
        },
      },
      {
        resources: {
          middleware: [],
          validate: [secondValidator],
        },
      },
      { override: true },
    );

    expect(merged.resources?.middleware).toEqual([]);
    expect(merged.resources?.validate).toEqual([secondValidator]);
  });
});
