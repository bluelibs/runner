import { defineTask, defineResource } from "../../define";
import { globals } from "../../index";
import { Store } from "../../models/Store";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { MiddlewareManager } from "../../models/MiddlewareManager";
import { run } from "../../run";
import { ResourceInitMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("DependencyExtractor interceptor branches", () => {
  it("skips interceptors without ownerResourceId in getInterceptingResourceIds", async () => {
    const task = defineTask({
      id: "extractor.interceptor.no-owner.task",
      run: async () => "intercepted",
    });

    const consumer = defineResource({
      id: "extractor.interceptor.no-owner.consumer",
      dependencies: { task, store: globals.resources.store },
      init: async (_config, { task, store }) => {
        const typedStore = store as Store;

        // Inject an interceptor WITHOUT ownerResourceId directly onto the store task
        const storeTask = typedStore.tasks.get(
          "extractor.interceptor.no-owner.task",
        );
        if (storeTask) {
          if (!storeTask.interceptors) storeTask.interceptors = [];
          storeTask.interceptors.push({
            interceptor: async ({
              next,
              input,
            }: {
              next: (value: unknown) => unknown;
              input: unknown;
            }) => next(input),
          } as any);
        }

        // Now call getInterceptingResourceIds — it should skip the ownerless entry
        return task.getInterceptingResourceIds();
      },
    });

    const app = defineResource({
      id: "extractor.interceptor.no-owner.app",
      register: [task, consumer],
      dependencies: { consumer },
      init: async (_config, { consumer }) => consumer,
    });

    const runtime = await run(app);
    // The ownerless interceptor is skipped, so the list is empty
    expect(runtime.value).toEqual([]);
    await runtime.dispose();
  });

  it("silently ignores unrecognized middleware in interceptMiddleware proxy", async () => {
    const consumer = defineResource({
      id: "extractor.proxy.unknown-mw.consumer",
      dependencies: {
        middlewareManager: globals.resources.middlewareManager,
      },
      init: async (_config, { middlewareManager }) => {
        const mgr = middlewareManager as MiddlewareManager;
        // Call interceptMiddleware with something that is not a recognized middleware
        mgr.interceptMiddleware(
          { id: "fake", __kind: "alien" } as any,
          (() => {}) as any,
        );
        return "ok";
      },
    });

    const app = defineResource({
      id: "extractor.proxy.unknown-mw.app",
      register: [consumer],
      dependencies: { consumer },
      init: async (_config, { consumer }) => consumer,
    });

    const runtime = await run(app);
    expect(runtime.value).toBe("ok");
    await runtime.dispose();
  });

  it("reuses in-flight task dependency initialization promise across concurrent callers", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const depTask = defineTask({
      id: "extractor.inflight.dep.task",
      run: async () => "dep",
    });
    const task = defineTask({
      id: "extractor.inflight.task",
      dependencies: { depTask },
      run: async () => "ok",
    });

    store.storeGenericItem(depTask);
    store.storeGenericItem(task);
    store.root = {
      resource: defineResource({ id: "extractor.inflight.root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Sequential,
    ) as unknown as {
      dependencyExtractor: {
        extractDependencies: (...args: any[]) => Promise<any>;
        extractTaskDependency: (task: any) => Promise<any>;
      };
    };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const extractDependenciesSpy = jest
      .spyOn(processor.dependencyExtractor, "extractDependencies")
      .mockImplementation(async (..._args: unknown[]) => {
        await gate;
        return extractDependenciesSpy.getMockImplementation()
          ? {}
          : ({} as any);
      });

    const p1 = processor.dependencyExtractor.extractTaskDependency(task as any);
    const p2 = processor.dependencyExtractor.extractTaskDependency(task as any);

    release();
    await Promise.all([p1, p2]);

    expect(extractDependenciesSpy).toHaveBeenCalledTimes(1);
  });
});
