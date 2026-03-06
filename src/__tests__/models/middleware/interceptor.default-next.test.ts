import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { TaskMiddlewareComposer } from "../../../models/middleware/TaskMiddlewareComposer";
import { LifecycleAdmissionController } from "../../../models/runtime/LifecycleAdmissionController";
import { defineResourceMiddleware } from "../../../define";

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

describe("Middleware interceptor default next() argument branches", () => {
  it("resource global interceptor uses executionInput.next() default config", async () => {
    const store: any = {
      resourceMiddlewares: new Map(),
      resources: new Map(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
      resolveDefinitionId,
      toPublicId: (id: string) => id,
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    };
    const interceptorRegistry = new InterceptorRegistry();
    const middlewareResolver = new MiddlewareResolver(store);
    const composer = new ResourceMiddlewareComposer(
      store,
      interceptorRegistry,
      middlewareResolver,
    );

    interceptorRegistry.addGlobalResourceInterceptor(async (_next, input) => {
      return input.next();
    });

    const resource: any = {
      id: "tests-resource-default-next",
      init: async (config: string) => config,
      middleware: [],
      resultSchema: undefined,
    };

    const out = await composer.runInit(resource, "cfg", {} as any, {} as any);
    expect(out).toBe("cfg");
  });

  it("resource global interceptor can override config via executionInput.next(config)", async () => {
    const store: any = {
      resourceMiddlewares: new Map(),
      resources: new Map(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
      resolveDefinitionId,
      toPublicId: (id: string) => id,
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    };
    const interceptorRegistry = new InterceptorRegistry();
    const middlewareResolver = new MiddlewareResolver(store);
    const composer = new ResourceMiddlewareComposer(
      store,
      interceptorRegistry,
      middlewareResolver,
    );

    interceptorRegistry.addGlobalResourceInterceptor(async (_next, input) => {
      return input.next("cfg-override");
    });

    const resource: any = {
      id: "tests-resource-override-next",
      init: async (config: string) => config,
      middleware: [],
      resultSchema: undefined,
    };

    const out = await composer.runInit(resource, "cfg", {} as any, {} as any);
    expect(out).toBe("cfg-override");
  });

  it("task global interceptor uses executionInput.next() default input", async () => {
    const task: any = {
      id: "tests-task-default-next",
      run: async (input: string) => input,
      middleware: [],
      inputSchema: undefined,
      resultSchema: undefined,
    };
    const store: any = {
      tasks: new Map([
        [
          task.id,
          {
            task,
            computedDependencies: {},
            interceptors: [],
          },
        ],
      ]),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      resources: new Map(),
      resolveDefinitionId,
      toPublicId: (id: string) => id,
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    };
    const interceptorRegistry = new InterceptorRegistry();
    const middlewareResolver = new MiddlewareResolver(store);
    const composer = new TaskMiddlewareComposer(
      store,
      interceptorRegistry,
      middlewareResolver,
    );

    interceptorRegistry.addGlobalTaskInterceptor(async (_next, input) => {
      return input.next();
    });

    const runner = composer.compose(task);
    await expect(runner("abc")).resolves.toBe("abc");
  });

  it("resource per-middleware interceptor uses executionInput.next() pass-through config", async () => {
    const middleware = defineResourceMiddleware({
      id: "tests-resource-per-middleware-default-next",
      run: async ({ next, resource }) => next(resource.config),
    });

    const store: any = {
      resourceMiddlewares: new Map([
        [
          middleware.id,
          {
            middleware,
            computedDependencies: {},
            isInitialized: true,
          },
        ],
      ]),
      resources: new Map(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
      resolveDefinitionId,
      toPublicId: (id: string) => id,
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    };
    const interceptorRegistry = new InterceptorRegistry();
    interceptorRegistry.addResourceMiddlewareInterceptor(
      middleware.id,
      async (_next, input) => input.next(),
    );

    const composer = new ResourceMiddlewareComposer(
      store,
      interceptorRegistry,
      new MiddlewareResolver(store),
    );

    const resource: any = {
      id: "tests-resource-per-middleware-default-next-target",
      middleware: [middleware],
      init: async (config: string) => config,
      resultSchema: undefined,
    };

    const out = await composer.runInit(resource, "cfg", {} as any, {} as any);
    expect(out).toBe("cfg");
  });

  it("resource per-middleware interceptor preserves explicit undefined for executionInput.next(undefined)", async () => {
    const middleware = defineResourceMiddleware({
      id: "tests-resource-per-middleware-explicit-undefined",
      run: async ({ next }) => next(undefined),
    });

    const store: any = {
      resourceMiddlewares: new Map([
        [
          middleware.id,
          {
            middleware,
            computedDependencies: {},
            isInitialized: true,
          },
        ],
      ]),
      resources: new Map(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
      resolveDefinitionId,
      toPublicId: (id: string) => id,
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    };
    const interceptorRegistry = new InterceptorRegistry();
    interceptorRegistry.addResourceMiddlewareInterceptor(
      middleware.id,
      async (_next, input) => input.next(undefined),
    );

    const composer = new ResourceMiddlewareComposer(
      store,
      interceptorRegistry,
      new MiddlewareResolver(store),
    );

    const resource: any = {
      id: "tests-resource-per-middleware-explicit-undefined-target",
      middleware: [middleware],
      init: async (config: string | undefined) => config,
      resultSchema: undefined,
    };

    const out = await composer.runInit(resource, "cfg", {} as any, {} as any);
    expect(out).toBeUndefined();
  });
});
