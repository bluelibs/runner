import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { TaskMiddlewareComposer } from "../../../models/middleware/TaskMiddlewareComposer";
import { ExecutionContextStore } from "../../../models/ExecutionContextStore";
import { LifecycleAdmissionController } from "../../../models/runtime/LifecycleAdmissionController";

function createBaseStore() {
  return {
    tasks: new Map(),
    resources: new Map(),
    taskMiddlewares: new Map(),
    resourceMiddlewares: new Map(),
    resolveDefinitionId: () => undefined,
    getOwnerResourceId: () => undefined,
    toPublicId: (id: string) => id,
    onUnhandledError: jest.fn(),
    getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
    getExecutionContextStore: () => new ExecutionContextStore(null),
    trackTaskAbortController: () => () => undefined,
  };
}

describe("MiddlewareComposer fallback id branches", () => {
  it("TaskMiddlewareComposer composes with String(reference) lookup fallback", async () => {
    const taskReference = {
      id: "",
      run: async (input: string) => input,
      middleware: [],
      inputSchema: undefined,
      resultSchema: undefined,
    };
    const store: any = createBaseStore();
    store.tasks.set(String(taskReference), {
      task: taskReference,
      computedDependencies: {},
      interceptors: [],
    });

    const resolver = new MiddlewareResolver(store);
    jest.spyOn(resolver, "getApplicableTaskMiddlewares").mockReturnValue([]);

    const composer = new TaskMiddlewareComposer(
      store,
      new InterceptorRegistry(),
      resolver,
    );
    const runner = composer.compose(taskReference as any);

    await expect(runner("ok")).resolves.toBe("ok");
  });

  it("ResourceMiddlewareComposer runs with String(reference) lookup fallback", async () => {
    const resourceReference = {
      id: "",
      init: async (config: string) => config,
      middleware: [],
      resultSchema: undefined,
    };
    const store: any = createBaseStore();
    const resolver = new MiddlewareResolver(store);
    jest
      .spyOn(resolver, "getApplicableResourceMiddlewares")
      .mockReturnValue([]);

    const composer = new ResourceMiddlewareComposer(
      store,
      new InterceptorRegistry(),
      resolver,
    );

    await expect(
      composer.runInit(resourceReference as any, "cfg", {} as any, {} as any),
    ).resolves.toBe("cfg");
  });
});
