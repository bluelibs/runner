import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { TaskMiddlewareComposer } from "../../../models/middleware/TaskMiddlewareComposer";

describe("Middleware interceptor default next() argument branches", () => {
  it("resource global interceptor uses executionInput.next() default config", async () => {
    const store: any = {
      resourceMiddlewares: new Map(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
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
      id: "tests.resource.default-next",
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
      taskMiddlewares: new Map(),
      tasks: new Map(),
      onUnhandledError: jest.fn(),
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
      id: "tests.resource.override-next",
      init: async (config: string) => config,
      middleware: [],
      resultSchema: undefined,
    };

    const out = await composer.runInit(resource, "cfg", {} as any, {} as any);
    expect(out).toBe("cfg-override");
  });

  it("task global interceptor uses executionInput.next() default input", async () => {
    const task: any = {
      id: "tests.task.default-next",
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
});
