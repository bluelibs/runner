import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";

describe("ResourceMiddlewareComposer Order Bug Repro", () => {
  let composer: ResourceMiddlewareComposer;
  let store: any;
  let interceptorRegistry: InterceptorRegistry;
  let middlewareResolver: MiddlewareResolver;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    store = {
      resourceMiddlewares: new Map(),
      onUnhandledError: jest.fn(),
      taskMiddlewares: new Map(),
      tasks: new Map(),
    };
    interceptorRegistry = new InterceptorRegistry();
    middlewareResolver = new MiddlewareResolver(store);
    composer = new ResourceMiddlewareComposer(
      store,
      interceptorRegistry,
      middlewareResolver,
    );
  });

  it("should apply global interceptors in registration order (FIFO)", async () => {
    // I1: "Outer"
    interceptorRegistry.addGlobalResourceInterceptor(async (next, input) => {
      callOrder.push("I1-Start");
      const res = await next(input);
      callOrder.push("I1-End");
      return res;
    });

    // I2: "Inner"
    interceptorRegistry.addGlobalResourceInterceptor(async (next, input) => {
      callOrder.push("I2-Start");
      const res = await next(input);
      callOrder.push("I2-End");
      return res;
    });

    // Current Code Logic expectation (hypothesized bug):
    // It does reverse() then iterates backwards.
    // [I1, I2] -> reversed [I2, I1]
    // Loop i=1 (I1) -> Wrapped = I1(Target)
    // Loop i=0 (I2) -> Wrapped = I2(I1(Target))
    // So I2 runs first.

    // Expected Logic (Intuition):
    // I1 is registered first, it should be the outermost wrapper.
    // I1(I2(Target))

    const resource: any = {
      id: "test",
      init: async () => {
        callOrder.push("Target");
        return "ok";
      },
      middleware: [],
      resultSchema: null,
    };

    await composer.runInit(resource, {}, {}, {});

    // If correct: I1-Start, I2-Start, Target, I2-End, I1-End
    // If buggy: I2-Start, I1-Start, Target, I1-End, I2-End

    // We assert the CORRECT behavior, so this test should FAIL if the bug exists.
    expect(callOrder).toEqual([
      "I1-Start",
      "I2-Start",
      "Target",
      "I2-End",
      "I1-End",
    ]);
  });
});
