import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { symbolRpcLanePolicy } from "../../../defs";

const resolveDefinitionId = (reference: unknown): string | undefined => {
  if (typeof reference === "string") {
    return reference;
  }
  if (reference && typeof reference === "object" && "id" in reference) {
    const id = (reference as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return undefined;
};

describe("MiddlewareResolver.applyRpcLanePolicyFilter", () => {
  test("throws when task is not registered", () => {
    const store: any = {
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      resolveDefinitionId,
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
      resolveDefinitionId,
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
      resolveDefinitionId,
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
      resolveDefinitionId,
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
      resolveDefinitionId,
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
      resolveDefinitionId,
      getOwnerResourceId: () => ownerResource.id,
    };

    const resolver = new MiddlewareResolver(store);
    const task = {
      id: "tests.task.target.visibility-fallback",
      middleware: [],
    } as any;

    expect(resolver.getEverywhereTaskMiddlewares(task)).toEqual([middleware]);
  });

  test("caches applicable task middlewares when store is locked", () => {
    const local = { id: "mw.local" } as any;
    const global = { id: "mw.global" } as any;
    const task: any = { id: "task.locked.cache", middleware: [local] };
    const store: any = {
      isLocked: true,
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      resolveDefinitionId,
      getOwnerResourceId: () => undefined,
    };

    const resolver = new MiddlewareResolver(store);
    const spy = jest
      .spyOn(resolver, "getEverywhereTaskMiddlewares")
      .mockReturnValue([global]);

    const first = resolver.getApplicableTaskMiddlewares(task);
    const second = resolver.getApplicableTaskMiddlewares(task);

    expect(first).toEqual([global, local]);
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("caches applicable resource middlewares when store is locked", () => {
    const local = { id: "mw.resource.local" } as any;
    const global = { id: "mw.resource.global" } as any;
    const resource: any = {
      id: "resource.locked.cache",
      middleware: [local],
    };
    const store: any = {
      isLocked: true,
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      resolveDefinitionId,
      getOwnerResourceId: () => undefined,
    };

    const resolver = new MiddlewareResolver(store);
    const spy = jest
      .spyOn(resolver, "getEverywhereResourceMiddlewares")
      .mockReturnValue([global]);

    const first = resolver.getApplicableResourceMiddlewares(resource);
    const second = resolver.getApplicableResourceMiddlewares(resource);

    expect(first).toEqual([global, local]);
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("caches rpc allowlist set when store is locked", () => {
    const task: any = {
      id: "task.rpc.locked.allow-list",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: ["mw.a"],
      },
    };
    const store: any = {
      isLocked: true,
      tasks: new Map([["task.rpc.locked.allow-list", { task }]]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      resolveDefinitionId,
      getOwnerResourceId: () => undefined,
    };
    const resolver = new MiddlewareResolver(store);
    const middlewares = [{ id: "mw.a" }, { id: "mw.b" }] as any[];

    const first = resolver.applyRpcLanePolicyFilter(task, middlewares);

    task[symbolRpcLanePolicy].middlewareAllowList = ["mw.b"];
    const second = resolver.applyRpcLanePolicyFilter(task, middlewares);

    expect(first).toEqual([{ id: "mw.a" }]);
    expect(second).toEqual([{ id: "mw.a" }]);
  });
});
