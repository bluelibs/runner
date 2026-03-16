import { symbolRpcLanePolicy } from "../../../defs";
import { validationError } from "../../../errors";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";

describe("MiddlewareResolver coverage gaps", () => {
  const createStore = () =>
    ({
      tasks: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      getOwnerResourceId: () => undefined,
      isLocked: false,
      resolveDefinitionId: () => undefined,
    }) as any;

  it("falls back to String(reference) when a definition id cannot be resolved", () => {
    const resolver = new MiddlewareResolver(createStore());

    expect((resolver as any).resolveDefinitionId(Symbol("fallback-id"))).toBe(
      "Symbol(fallback-id)",
    );
  });

  it("resolves middleware allow list ids from id-like object references", () => {
    const resolver = new MiddlewareResolver(createStore());

    expect(
      (resolver as any).resolveRegisteredMiddlewareId(
        { id: "middleware.object-id" },
        "app.tasks.target",
      ),
    ).toBe("middleware.object-id");
  });

  it("runs unresolved allow list validation path and preserves fallback formatting", () => {
    const task = {
      id: "app.tasks.rpc.target",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: [Symbol("missing-middleware")],
      },
    };
    const store = createStore();
    store.tasks.set(task.id, { task });
    const resolver = new MiddlewareResolver(store);

    const throwSpy = jest
      .spyOn(Object.getPrototypeOf(validationError), "throw")
      .mockImplementation(() => undefined as never);

    expect(
      resolver.applyRpcLanePolicyFilter(task as any, [{ id: "ok" }] as any),
    ).toEqual([]);
    expect(throwSpy).toHaveBeenCalledWith({
      subject: "rpcLane middlewareAllowList",
      id: task.id,
      originalError:
        'Middleware "Symbol(missing-middleware)" is not registered.',
    });
  });
});
