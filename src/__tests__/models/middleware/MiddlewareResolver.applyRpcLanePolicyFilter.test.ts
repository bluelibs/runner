import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { symbolRpcLanePolicy } from "../../../defs";

describe("MiddlewareResolver.applyRpcLanePolicyFilter", () => {
  test("throws when task is not registered", () => {
    const store: any = {
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
    };

    const resolver = new MiddlewareResolver(store);
    const task: any = { id: "unregistered", middleware: [] };

    expect(() => resolver.applyRpcLanePolicyFilter(task, [])).toThrow(
      /Task "unregistered" is not registered/,
    );
  });

  test("applies middleware allow list from routed task lane policy", () => {
    const task: any = {
      id: "registered",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: ["mw.a"],
      },
    };
    const store: any = {
      tasks: new Map([["registered", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
    };
    const resolver = new MiddlewareResolver(store);
    const middlewares = [{ id: "mw.a" }, { id: "mw.b" }] as any[];

    expect(resolver.applyRpcLanePolicyFilter(task, middlewares)).toEqual([
      { id: "mw.a" },
    ]);
  });

  test("returns empty list when routed task has no allow list policy", () => {
    const task: any = {
      id: "registered.grouped",
      middleware: [],
      isRpcRouted: true,
    };
    const store: any = {
      tasks: new Map([["registered.grouped", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
    };
    const resolver = new MiddlewareResolver(store);
    const middlewares = [{ id: "mw.keep" }, { id: "mw.drop" }] as any[];

    expect(resolver.applyRpcLanePolicyFilter(task, middlewares)).toEqual([]);
  });

  test("supports legacy object middleware ids in lane policy allow list", () => {
    const task: any = {
      id: "registered.legacy-allow-list",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: [{ id: "mw.legacy.allowed" }],
      },
    };
    const store: any = {
      tasks: new Map([["registered.legacy-allow-list", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
    };
    const resolver = new MiddlewareResolver(store);

    expect(
      resolver.applyRpcLanePolicyFilter(task, [
        { id: "mw.legacy.allowed" },
        { id: "mw.legacy.blocked" },
      ] as any[]),
    ).toEqual([{ id: "mw.legacy.allowed" }]);
  });

  test("does not auto-apply subtree middleware when owner cannot be resolved", () => {
    const middleware = {
      id: "tests.middleware.subtree.owner-missing",
      run: async ({ next }: any) => next(),
    };

    const store: any = {
      tasks: new Map(),
      taskMiddlewares: new Map([[middleware.id, { middleware }]]),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
      isItemWithinResourceSubtree: () => false,
      isItemVisibleToConsumer: () => true,
    };

    const resolver = new MiddlewareResolver(store);
    const task = { id: "tests.task.target", middleware: [] } as any;

    expect(resolver.getEverywhereTaskMiddlewares(task)).toEqual([]);
  });

  test("resolves owner from store helper", () => {
    const middleware = {
      id: "tests.middleware.subtree.visibility-fallback",
      run: async ({ next }: any) => next(),
    };

    const ownerResource = {
      id: "tests.middleware.subtree.visibility-fallback.owner",
      middleware: [],
      subtree: {
        tasks: {
          middleware: [middleware],
          validate: [],
        },
      },
    };

    const store: any = {
      tasks: new Map([
        [
          "tests.task.target.visibility-fallback",
          {
            task: {
              id: "tests.task.target.visibility-fallback",
              middleware: [],
            },
          },
        ],
      ]),
      taskMiddlewares: new Map([[middleware.id, { middleware }]]),
      resourceMiddlewares: new Map(),
      resources: new Map([[ownerResource.id, { resource: ownerResource }]]),
      getOwnerResourceId: () => ownerResource.id,
    };

    const resolver = new MiddlewareResolver(store);
    const task = {
      id: "tests.task.target.visibility-fallback",
      middleware: [],
    } as any;

    expect(resolver.getEverywhereTaskMiddlewares(task)).toEqual([middleware]);
  });
});
