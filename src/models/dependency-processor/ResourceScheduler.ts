import { parallelInitSchedulingError } from "../../errors";
import { ResourceStoreElementType } from "../../types/storeTypes";
import { Store } from "../Store";
import {
  isHook,
  isOptional,
  isResource,
  isResourceWithConfig,
  isResourceMiddleware,
  isTag,
  isTagStartup,
  isTask,
  isTaskMiddleware,
} from "../../define";
import type {
  IResource,
  ITag,
  ITask,
  IHook,
  ITaskMiddleware,
  IResourceMiddleware,
} from "../../defs";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
} from "../StoreLookup";

type DependencyTraversalState = {
  resourceIds: Set<string>;
  visitedDefinitions: Set<string>;
  visitedTagLookups: Set<string>;
};

type ResourceDependencyCollectionOptions = {
  includeTransitiveResourceDependencies?: boolean;
  targetSet?: Set<string>;
};

function readDefinitionSourceId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (isResourceWithConfig(value)) {
    return value.resource.id;
  }

  if (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    "id" in value
  ) {
    const sourceId = (value as { id?: unknown }).id;
    if (typeof sourceId === "string" && sourceId.length > 0) {
      return sourceId;
    }
  }

  return undefined;
}

export class ResourceScheduler {
  constructor(
    private readonly store: Store,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
      options?: { trackInitCompletion?: boolean },
    ) => Promise<void>,
  ) {}

  collectStartupRequiredResourceIds(): Set<string> {
    const requiredResourceIds = new Set<string>();

    for (const middleware of this.store.resourceMiddlewares.values()) {
      this.collectResourceDependenciesFromMap(
        middleware.middleware.dependencies,
        middleware.middleware.id,
        { targetSet: requiredResourceIds },
      );
    }

    for (const middleware of this.store.taskMiddlewares.values()) {
      this.collectResourceDependenciesFromMap(
        middleware.middleware.dependencies,
        middleware.middleware.id,
        { targetSet: requiredResourceIds },
      );
    }

    for (const hook of this.store.hooks.values()) {
      this.collectResourceDependenciesFromMap(
        hook.hook.dependencies,
        hook.hook.id,
        { targetSet: requiredResourceIds },
      );
    }

    for (const task of this.store.tasks.values()) {
      this.collectResourceDependenciesFromMap(
        task.task.dependencies,
        task.task.id,
        { targetSet: requiredResourceIds },
      );
    }

    this.collectResourceDependenciesFromMap(
      this.store.root.resource.dependencies,
      this.store.root.resource.id,
      { targetSet: requiredResourceIds },
    );

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
        parallelInitSchedulingError.throw({
          pendingResourceIds: pending.map((resource) => resource.resource.id),
          blockedDependencies: pending.map((resource) => {
            const dependencyIds = this.collectResourceDependenciesFromMap(
              resource.resource.dependencies,
              resource.resource.id,
              { includeTransitiveResourceDependencies: false },
            ).filter((dependencyId) => {
              const dependencyResource = this.store.resources.get(dependencyId);
              return dependencyResource?.isInitialized !== true;
            });

            return {
              resourceId: resource.resource.id,
              dependencyIds,
            };
          }),
        });
      }

      const results = await Promise.allSettled(
        readyWave.map((resource) =>
          this.ensureResourceInitialized(resource, {
            trackInitCompletion: false,
          }),
        ),
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

      this.store.recordInitWave(
        readyWave.map((resource) => resource.resource.id),
      );
    }
  }

  isResourceReadyForParallelInit(
    resource: ResourceStoreElementType<any, any, any>,
  ): boolean {
    const dependencyIds = this.collectResourceDependenciesFromMap(
      resource.resource.dependencies,
      resource.resource.id,
      { includeTransitiveResourceDependencies: false },
    );

    return dependencyIds.every((dependencyId) => {
      const dependencyResource = this.store.resources.get(dependencyId);
      return dependencyResource?.isInitialized === true;
    });
  }

  private collectResourceDependenciesFromMap(
    dependencies: unknown,
    consumerId: string,
    options: ResourceDependencyCollectionOptions = {},
  ): string[] {
    const { includeTransitiveResourceDependencies = true, targetSet } = options;
    const state: DependencyTraversalState = {
      resourceIds: targetSet ?? new Set<string>(),
      visitedDefinitions: new Set<string>(),
      visitedTagLookups: new Set<string>(),
    };

    this.traverseDependencies(dependencies, consumerId, state, {
      includeTransitiveResourceDependencies,
    });

    return Array.from(state.resourceIds);
  }

  private traverseDependencies(
    dependencies: unknown,
    consumerId: string,
    state: DependencyTraversalState,
    options: {
      includeTransitiveResourceDependencies: boolean;
    },
  ): void {
    if (!dependencies || typeof dependencies !== "object") {
      return;
    }

    for (const dependency of Object.values(
      dependencies as Record<string, unknown>,
    )) {
      this.traverseDependency(dependency, consumerId, state, options);
    }
  }

  private traverseDependency(
    dependency: unknown,
    consumerId: string,
    state: DependencyTraversalState,
    options: {
      includeTransitiveResourceDependencies: boolean;
    },
  ): void {
    const optionalDependency = isOptional(dependency);
    const rawDependency = optionalDependency
      ? (dependency as { inner: unknown }).inner
      : dependency;

    if (isResource(rawDependency)) {
      this.collectResourceDependency(
        rawDependency,
        optionalDependency,
        state,
        options,
      );
      return;
    }

    const nestedDependencies = this.getRegisteredDependencies(rawDependency);
    if (nestedDependencies) {
      const key = this.getDefinitionVisitKey(rawDependency);
      if (!state.visitedDefinitions.has(key)) {
        state.visitedDefinitions.add(key);
        this.traverseDependencies(
          nestedDependencies,
          this.resolveDefinitionId(rawDependency),
          state,
          options,
        );
      }
      return;
    }

    if (isTagStartup(rawDependency)) {
      this.expandTagDependency(rawDependency.tag, consumerId, state, options);
      return;
    }

    if (isTag(rawDependency)) {
      this.expandTagDependency(rawDependency, consumerId, state, options);
    }
  }

  private collectResourceDependency(
    resource: IResource<any, any, any>,
    optionalDependency: boolean,
    state: DependencyTraversalState,
    options: {
      includeTransitiveResourceDependencies: boolean;
    },
  ): void {
    const resourceId = this.resolveDefinitionId(resource);
    const storedResource = this.store.resources.get(resourceId);
    if (!storedResource) {
      if (!optionalDependency) {
        state.resourceIds.add(resourceId);
      }
      return;
    }

    state.resourceIds.add(resourceId);
    if (!options.includeTransitiveResourceDependencies) {
      return;
    }

    const key = `resource:${resourceId}`;
    if (state.visitedDefinitions.has(key)) {
      return;
    }

    state.visitedDefinitions.add(key);
    this.traverseDependencies(
      storedResource.resource.dependencies,
      storedResource.resource.id,
      state,
      options,
    );
  }

  private getRegisteredDependencies(value: unknown): unknown | undefined {
    if (isTask(value)) {
      const id = this.resolveDefinitionId(value);
      return this.store.tasks.get(id)?.task.dependencies;
    }
    if (isHook(value)) {
      const id = this.resolveDefinitionId(value);
      return this.store.hooks.get(id)?.hook.dependencies;
    }
    if (isTaskMiddleware(value)) {
      const id = this.resolveDefinitionId(value);
      return this.store.taskMiddlewares.get(id)?.middleware.dependencies;
    }
    if (isResourceMiddleware(value)) {
      const id = this.resolveDefinitionId(value);
      return this.store.resourceMiddlewares.get(id)?.middleware.dependencies;
    }

    return undefined;
  }

  private getDefinitionVisitKey(value: unknown): string {
    if (isTask(value)) {
      return `task:${this.resolveDefinitionId(value)}`;
    }
    if (isHook(value)) {
      return `hook:${this.resolveDefinitionId(value)}`;
    }
    if (isTaskMiddleware(value)) {
      return `taskMiddleware:${this.resolveDefinitionId(value)}`;
    }
    const middleware = value as IResourceMiddleware<any, any, any, any>;
    return `resourceMiddleware:${this.resolveDefinitionId(middleware)}`;
  }

  private expandTagDependency(
    tag: ITag<any, any, any>,
    consumerId: string,
    state: DependencyTraversalState,
    options: {
      includeTransitiveResourceDependencies: boolean;
    },
  ): void {
    const tagId = this.resolveDefinitionId(tag);
    const tagLookupKey = `${consumerId}|${tagId}`;
    if (state.visitedTagLookups.has(tagLookupKey)) {
      return;
    }
    state.visitedTagLookups.add(tagLookupKey);

    const effectiveTag = this.store.tags.get(tagId)! as ITag<any, any, any>;
    const accessor = this.store.getTagAccessor(effectiveTag, {
      consumerId,
      includeSelf: false,
    });

    for (const entry of accessor.resources) {
      this.traverseDependency(
        entry.definition as IResource<any, any, any>,
        consumerId,
        state,
        options,
      );
    }

    for (const entry of accessor.tasks) {
      this.traverseDependency(
        entry.definition as ITask<any, any, any>,
        consumerId,
        state,
        options,
      );
    }

    for (const entry of accessor.hooks) {
      this.traverseDependency(
        entry.definition as IHook<any, any, any>,
        consumerId,
        state,
        options,
      );
    }

    for (const entry of accessor.taskMiddlewares) {
      this.traverseDependency(
        entry.definition as ITaskMiddleware<any, any, any, any>,
        consumerId,
        state,
        options,
      );
    }

    for (const entry of accessor.resourceMiddlewares) {
      this.traverseDependency(
        entry.definition as IResourceMiddleware<any, any, any, any>,
        consumerId,
        state,
        options,
      );
    }
  }

  private resolveDefinitionId(value: unknown): string {
    return (
      resolveCanonicalIdFromStore(this.store, value) ??
      extractRequestedId(value) ??
      readDefinitionSourceId(value) ??
      String(value)
    );
  }
}
