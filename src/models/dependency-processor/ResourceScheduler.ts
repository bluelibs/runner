import { parallelInitSchedulingError } from "../../errors";
import { ResourceStoreElementType } from "../../types/storeTypes";
import { Store } from "../Store";
import { getResourceDependencyIds } from "../utils/resourceDependencyIds";

export class ResourceScheduler {
  constructor(
    private readonly store: Store,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
    ) => Promise<void>,
  ) {}

  collectStartupRequiredResourceIds(): Set<string> {
    const requiredResourceIds = new Set<string>();
    const pendingResourceIds: string[] = [];

    const collectFromDependencies = (dependencies: unknown) => {
      const dependencyIds = getResourceDependencyIds(dependencies);
      for (const dependencyId of dependencyIds) {
        if (requiredResourceIds.has(dependencyId)) {
          continue;
        }

        const dependencyResource = this.store.resources.get(dependencyId);
        if (!dependencyResource) {
          continue;
        }

        requiredResourceIds.add(dependencyId);
        pendingResourceIds.push(dependencyId);
      }
    };

    for (const middleware of this.store.resourceMiddlewares.values()) {
      collectFromDependencies(middleware.middleware.dependencies);
    }

    for (const middleware of this.store.taskMiddlewares.values()) {
      collectFromDependencies(middleware.middleware.dependencies);
    }

    for (const hook of this.store.hooks.values()) {
      collectFromDependencies(hook.hook.dependencies);
    }

    for (const task of this.store.tasks.values()) {
      collectFromDependencies(task.task.dependencies);
    }

    collectFromDependencies(this.store.root.resource.dependencies);

    while (pendingResourceIds.length > 0) {
      const resourceId = pendingResourceIds.pop()!;
      const resource = this.store.resources.get(resourceId);
      if (!resource) {
        continue;
      }

      collectFromDependencies(resource.resource.dependencies);
    }

    return requiredResourceIds;
  }

  async initializeUninitializedResourcesParallel(
    targetResourceIds?: ReadonlySet<string>,
  ): Promise<void> {
    const rootId = this.store.root.resource.id;

    while (true) {
      const pending = Array.from(this.store.resources.values()).filter(
        (resource) =>
          resource.resource.id !== rootId &&
          resource.isInitialized === false &&
          (targetResourceIds === undefined ||
            targetResourceIds.has(resource.resource.id)),
      );
      if (pending.length === 0) {
        return;
      }

      const readyWave = pending.filter((resource) =>
        this.isResourceReadyForParallelInit(resource),
      );

      if (readyWave.length === 0) {
        parallelInitSchedulingError.throw();
      }

      const results = await Promise.allSettled(
        readyWave.map((resource) => this.ensureResourceInitialized(resource)),
      );
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason)),
        );

      if (failures.length === 1) {
        throw failures[0];
      }

      if (failures.length > 1) {
        throw Object.assign(
          new Error(
            `${failures.length} resources failed during parallel initialization.`,
          ),
          {
            name: "AggregateError",
            errors: failures,
            cause: failures[0],
          },
        );
      }
    }
  }

  isResourceReadyForParallelInit(
    resource: ResourceStoreElementType<any, any, any>,
  ): boolean {
    const dependencyIds = getResourceDependencyIds(
      resource.resource.dependencies,
    );
    return dependencyIds.every((dependencyId) => {
      const dependencyResource = this.store.resources.get(dependencyId);
      return dependencyResource?.isInitialized === true;
    });
  }
}
