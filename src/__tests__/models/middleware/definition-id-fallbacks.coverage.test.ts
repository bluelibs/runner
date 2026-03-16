import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { TaskMiddlewareComposer } from "../../../models/middleware/TaskMiddlewareComposer";
import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { LifecycleAdmissionController } from "../../../models/runtime/LifecycleAdmissionController";
import { symbolRpcLanePolicy } from "../../../defs";

function createStore() {
  return {
    tasks: new Map(),
    resources: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    errors: new Map(),
    getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
  };
}

describe("middleware definition id fallbacks", () => {
  it("stringifies unknown references when middleware resolver cannot extract an id", () => {
    const resolver = new MiddlewareResolver(createStore() as any);

    expect((resolver as any).resolveDefinitionId(123)).toBe("123");
  });

  it("fails fast when rpc allowlist entries cannot resolve to a registered middleware id", () => {
    const task = {
      id: "app.tasks.invalid-allow-list",
      middleware: [],
      isRpcRouted: true,
      [symbolRpcLanePolicy]: {
        middlewareAllowList: [123],
      },
    };
    const store = createStore();
    store.tasks.set(task.id, { task });
    const resolver = new MiddlewareResolver(store as any);

    expect(() => resolver.applyRpcLanePolicyFilter(task as any, [])).toThrow(
      /Middleware "123" is not registered/,
    );
  });

  it("stringifies unknown references in the task middleware composer fallback path", () => {
    const store = createStore();
    const composer = new TaskMiddlewareComposer(
      store as any,
      new InterceptorRegistry(),
      new MiddlewareResolver(store as any),
    );

    expect((composer as any).resolveDefinitionId(456)).toBe("456");
  });

  it("stringifies unknown references in the resource middleware composer fallback path", () => {
    const store = createStore();
    const composer = new ResourceMiddlewareComposer(
      store as any,
      new InterceptorRegistry(),
      new MiddlewareResolver(store as any),
    );

    expect((composer as any).resolveDefinitionId(true)).toBe("true");
  });
});
