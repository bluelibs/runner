import { InterceptorRegistry } from "../../../models/middleware/InterceptorRegistry";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { ResourceMiddlewareComposer } from "../../../models/middleware/ResourceMiddlewareComposer";
import { TaskMiddlewareComposer } from "../../../models/middleware/TaskMiddlewareComposer";
import { ExecutionContextStore } from "../../../models/ExecutionContextStore";
import { LifecycleAdmissionController } from "../../../models/runtime/LifecycleAdmissionController";

describe("middleware composers coverage gaps", () => {
  const createBaseStore = () =>
    ({
      tasks: new Map(),
      resources: new Map(),
      taskMiddlewares: new Map(),
      resourceMiddlewares: new Map(),
      onUnhandledError: jest.fn(),
      getOwnerResourceId: () => undefined,
      getLifecycleAdmissionController: () => new LifecycleAdmissionController(),
      getExecutionContextStore: () => new ExecutionContextStore(null),
      resolveDefinitionId: () => undefined,
      hasDefinition: () => false,
      findIdByDefinition: () => undefined,
    }) as any;

  it("TaskMiddlewareComposer resolves task id from String(reference) fallback", async () => {
    const store = createBaseStore();
    const taskReference = {
      run: async (input: string) => input.toUpperCase(),
      middleware: [],
      inputSchema: undefined,
      resultSchema: undefined,
    };

    const storedTaskEntry = {
      task: taskReference,
      computedDependencies: {},
      interceptors: [],
    };
    store.tasks.set(String(taskReference), storedTaskEntry);

    const composer = new TaskMiddlewareComposer(
      store,
      new InterceptorRegistry(),
      new MiddlewareResolver(store),
    );

    await expect(composer.compose(taskReference as any)("ok")).resolves.toBe(
      "OK",
    );
  });

  it("ResourceMiddlewareComposer resolves resource id from String(reference) fallback", async () => {
    const store = createBaseStore();
    const resourceReference = {};
    const storedResource = {
      id: "app.resources.fallback.resource",
      init: async (config: string) => `resource:${config}`,
      middleware: [],
      resultSchema: undefined,
    };

    store.resources.set(String(resourceReference), {
      resource: storedResource,
    });

    const composer = new ResourceMiddlewareComposer(
      store,
      new InterceptorRegistry(),
      new MiddlewareResolver(store),
    );

    await expect(
      composer.runInit(resourceReference as any, "cfg", {} as any, {} as any),
    ).resolves.toBe("resource:cfg");
  });
});
