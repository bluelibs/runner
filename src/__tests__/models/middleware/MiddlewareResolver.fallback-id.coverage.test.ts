import { symbolRpcLanePolicy } from "../../../defs";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";

describe("MiddlewareResolver fallback id branches", () => {
  it("uses String(reference) task ids when canonical and requested ids are missing", () => {
    const taskReference = {
      id: "",
      middleware: [],
    };
    const storeTask = {
      id: "store.task.fallback",
      middleware: [],
    };
    const store: any = {
      tasks: new Map([[String(taskReference), { task: storeTask }]]),
      resources: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resolveDefinitionId: () => undefined,
      getOwnerResourceId: () => undefined,
    };

    const resolver = new MiddlewareResolver(store);
    jest.spyOn(resolver, "getEverywhereTaskMiddlewares").mockReturnValue([]);

    expect(resolver.getApplicableTaskMiddlewares(taskReference as any)).toEqual(
      [],
    );
  });

  it("fails fast when rpc lane allow-list contains entries with no resolvable id", () => {
    const task = {
      id: "task.with.invalid.allow-list",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: [Symbol("missing-middleware-id")],
      },
    };
    const store: any = {
      tasks: new Map([[task.id, { task }]]),
      resources: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resolveDefinitionId: () => undefined,
      getOwnerResourceId: () => undefined,
    };
    const resolver = new MiddlewareResolver(store);

    expect(() =>
      resolver.applyRpcLanePolicyFilter(task as any, [{ id: "mw" }] as any[]),
    ).toThrow(/missing-middleware-id|not registered/i);
  });
});
