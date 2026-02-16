import { defineResource, defineTask } from "../../define";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { ResourceStoreElementType } from "../../types/storeTypes";
import { createTestFixture } from "../test-utils";

class TestDependencyProcessor extends DependencyProcessor {
  public processResourceDependenciesForTest(
    resource: ResourceStoreElementType<any, any, any>,
  ) {
    return this.processResourceDependencies(resource);
  }
}

describe("DependencyProcessor zero-dependency caching", () => {
  it("does not recompute dependencies for a zero-dependency resource once computed", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const resource = defineResource({
      id: "dependency.processor.zero.deps.resource",
    });

    store.storeGenericItem(resource);

    const processor = new TestDependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    const extractDependenciesSpy = jest.spyOn(processor, "extractDependencies");
    const storeElement = store.resources.get(resource.id)!;

    await processor.processResourceDependenciesForTest(storeElement);
    await processor.processResourceDependenciesForTest(storeElement);

    expect(extractDependenciesSpy).toHaveBeenCalledTimes(1);
  });

  it("throws a clear dependency error when a wrapped task dependency is missing at call time", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const dependencyTask = defineTask({
      id: "dependency.processor.missing.task.dep",
      run: async (input: number | undefined) => input ?? 0,
    });

    const consumerResource = defineResource({
      id: "dependency.processor.missing.task.consumer",
      dependencies: {
        dependencyTask,
      },
      init: async () => "ready",
    });

    store.storeGenericItem(dependencyTask);
    store.storeGenericItem(consumerResource);

    const processor = new TestDependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );
    const storeElement = store.resources.get(consumerResource.id)!;
    await processor.processResourceDependenciesForTest(storeElement);

    const wrappedTaskDependency = (
      storeElement.computedDependencies as {
        dependencyTask: ((input: number | undefined) => Promise<number>) & {
          intercept: (
            middleware: (
              next: (input: number | undefined) => Promise<number>,
              input: number | undefined,
            ) => Promise<number> | number,
          ) => void;
        };
      }
    ).dependencyTask;

    store.tasks.delete(dependencyTask.id);

    expect(() => wrappedTaskDependency(1)).toThrow(
      /Dependency Task dependency\.processor\.missing\.task\.dep not found/,
    );
    expect(() =>
      wrappedTaskDependency.intercept(async (_next, input) => input ?? 0),
    ).toThrow(
      /Dependency Task dependency\.processor\.missing\.task\.dep not found/,
    );
  });
});
