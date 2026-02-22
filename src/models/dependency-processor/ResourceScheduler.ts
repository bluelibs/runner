import { parallelInitSchedulingError } from "../../errors";
import { ResourceStoreElementType } from "../../types/storeTypes";
import { Store } from "../Store";
import {
  isHook,
  isOptional,
  isResource,
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

type DependencyTraversalState = {
  resourceIds: Set<string>;
  visitedDefinitions: Set<string>;
  visitedTagLookups: Set<string>;
};

export class ResourceScheduler {
  constructor(
    private readonly store: Store,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
    ) => Promise<void>,
  ) {}

  collectStartupRequiredResourceIds(): Set<string> {
    const requiredResourceIds = new Set<string>();

    for (const middleware of this.store.resourceMiddlewares.values()) {
      this.collectResourceDependenciesFromMap(
        middleware.middleware.dependencies,
        middleware.middleware.id,
        requiredResourceIds,
      );
    }

    for (const middleware of this.store.taskMiddlewares.values()) {
      this.collectResourceDependenciesFromMap(
        middleware.middleware.dependencies,
        middleware.middleware.id,
        requiredResourceIds,
      );
    }

    for (const hook of this.store.hooks.values()) {
      this.collectResourceDependenciesFromMap(
        hook.hook.dependencies,
        hook.hook.id,
        requiredResourceIds,
      );
    }

    for (const task of this.store.tasks.values()) {
      this.collectResourceDependenciesFromMap(
        task.task.dependencies,
        task.task.id,
        requiredResourceIds,
      );
    }

    this.collectResourceDependenciesFromMap(
      this.store.root.resource.dependencies,
      this.store.root.resource.id,
      requiredResourceIds,
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
    const dependencyIds = this.collectDirectResourceDependenciesFromMap(
      resource.resource.dependencies,
      resource.resource.id,
    );

    return dependencyIds.every((dependencyId) => {
      const dependencyResource = this.store.resources.get(dependencyId);
      return dependencyResource?.isInitialized === true;
    });
  }

  private collectDirectResourceDependenciesFromMap(
    dependencies: unknown,
    consumerId: string,
  ): string[] {
    const state: DependencyTraversalState = {
      resourceIds: new Set<string>(),
      visitedDefinitions: new Set<string>(),
      visitedTagLookups: new Set<string>(),
    };

    this.traverseDirectDependencies(dependencies, consumerId, state);

    return Array.from(state.resourceIds);
  }

  private traverseDirectDependencies(
    dependencies: unknown,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    if (!dependencies || typeof dependencies !== "object") {
      return;
    }

    for (const dependency of Object.values(
      dependencies as Record<string, unknown>,
    )) {
      this.traverseDirectDependency(dependency, consumerId, state);
    }
  }

  private traverseDirectDependency(
    dependency: unknown,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    const optionalDependency = isOptional(dependency);
    const rawDependency = optionalDependency
      ? (dependency as { inner: unknown }).inner
      : dependency;

    if (isResource(rawDependency)) {
      const storedResource = this.store.resources.get(rawDependency.id);
      if (!storedResource) {
        if (!optionalDependency) {
          state.resourceIds.add(rawDependency.id);
        }
        return;
      }
      state.resourceIds.add(rawDependency.id);
      return;
    }

    const nestedDependencies = this.getRegisteredDependencies(rawDependency);
    if (nestedDependencies) {
      const key = this.getDefinitionVisitKey(rawDependency);
      if (!state.visitedDefinitions.has(key)) {
        state.visitedDefinitions.add(key);
        this.traverseDirectDependencies(
          nestedDependencies,
          (rawDependency as { id: string }).id,
          state,
        );
      }
      return;
    }

    if (isTagStartup(rawDependency)) {
      this.expandDirectTagDependency(rawDependency.tag, consumerId, state);
      return;
    }

    if (isTag(rawDependency)) {
      this.expandDirectTagDependency(rawDependency, consumerId, state);
    }
  }

  private expandDirectTagDependency(
    tag: ITag<any, any, any>,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    const tagLookupKey = `${consumerId}|${tag.id}`;
    if (state.visitedTagLookups.has(tagLookupKey)) {
      return;
    }
    state.visitedTagLookups.add(tagLookupKey);

    const accessor = this.store.getTagAccessor(tag, {
      consumerId,
      includeSelf: false,
    });

    for (const entry of accessor.resources) {
      this.traverseDirectDependency(
        entry.definition as IResource<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.tasks) {
      this.traverseDirectDependency(
        entry.definition as ITask<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.hooks) {
      this.traverseDirectDependency(
        entry.definition as IHook<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.taskMiddlewares) {
      this.traverseDirectDependency(
        entry.definition as ITaskMiddleware<any, any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.resourceMiddlewares) {
      this.traverseDirectDependency(
        entry.definition as IResourceMiddleware<any, any, any, any>,
        consumerId,
        state,
      );
    }
  }

  private collectResourceDependenciesFromMap(
    dependencies: unknown,
    consumerId: string,
    targetSet?: Set<string>,
  ): string[] {
    const state: DependencyTraversalState = {
      resourceIds: targetSet ?? new Set<string>(),
      visitedDefinitions: new Set<string>(),
      visitedTagLookups: new Set<string>(),
    };

    this.traverseDependencies(dependencies, consumerId, state);

    return Array.from(state.resourceIds);
  }

  private traverseDependencies(
    dependencies: unknown,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    if (!dependencies || typeof dependencies !== "object") {
      return;
    }

    for (const dependency of Object.values(
      dependencies as Record<string, unknown>,
    )) {
      this.traverseDependency(dependency, consumerId, state);
    }
  }

  private traverseDependency(
    dependency: unknown,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    const optionalDependency = isOptional(dependency);
    const rawDependency = optionalDependency
      ? (dependency as { inner: unknown }).inner
      : dependency;

    if (isResource(rawDependency)) {
      this.collectResourceDependency(rawDependency, optionalDependency, state);
      return;
    }

    const nestedDependencies = this.getRegisteredDependencies(rawDependency);
    if (nestedDependencies) {
      const key = this.getDefinitionVisitKey(rawDependency);
      if (!state.visitedDefinitions.has(key)) {
        state.visitedDefinitions.add(key);
        this.traverseDependencies(
          nestedDependencies,
          (rawDependency as { id: string }).id,
          state,
        );
      }
      return;
    }

    if (isTagStartup(rawDependency)) {
      this.expandTagDependency(rawDependency.tag, consumerId, state);
      return;
    }

    if (isTag(rawDependency)) {
      this.expandTagDependency(rawDependency, consumerId, state);
    }
  }

  private collectResourceDependency(
    resource: IResource<any, any, any>,
    optionalDependency: boolean,
    state: DependencyTraversalState,
  ): void {
    const storedResource = this.store.resources.get(resource.id);
    if (!storedResource) {
      if (!optionalDependency) {
        state.resourceIds.add(resource.id);
      }
      return;
    }

    state.resourceIds.add(resource.id);
    const key = `resource:${resource.id}`;
    if (state.visitedDefinitions.has(key)) {
      return;
    }

    state.visitedDefinitions.add(key);
    this.traverseDependencies(
      storedResource.resource.dependencies,
      storedResource.resource.id,
      state,
    );
  }

  private getRegisteredDependencies(value: unknown): unknown | undefined {
    if (isTask(value)) {
      return this.store.tasks.get(value.id)?.task.dependencies;
    }
    if (isHook(value)) {
      return this.store.hooks.get(value.id)?.hook.dependencies;
    }
    if (isTaskMiddleware(value)) {
      return this.store.taskMiddlewares.get(value.id)?.middleware.dependencies;
    }
    if (isResourceMiddleware(value)) {
      return this.store.resourceMiddlewares.get(value.id)?.middleware
        .dependencies;
    }

    return undefined;
  }

  private getDefinitionVisitKey(value: unknown): string {
    if (isTask(value)) {
      return `task:${value.id}`;
    }
    if (isHook(value)) {
      return `hook:${value.id}`;
    }
    if (isTaskMiddleware(value)) {
      return `taskMiddleware:${value.id}`;
    }
    return `resourceMiddleware:${(value as IResourceMiddleware<any, any, any, any>).id}`;
  }

  private expandTagDependency(
    tag: ITag<any, any, any>,
    consumerId: string,
    state: DependencyTraversalState,
  ): void {
    const tagLookupKey = `${consumerId}|${tag.id}`;
    if (state.visitedTagLookups.has(tagLookupKey)) {
      return;
    }
    state.visitedTagLookups.add(tagLookupKey);

    const accessor = this.store.getTagAccessor(tag, {
      consumerId,
      includeSelf: false,
    });

    for (const entry of accessor.resources) {
      this.traverseDependency(
        entry.definition as IResource<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.tasks) {
      this.traverseDependency(
        entry.definition as ITask<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.hooks) {
      this.traverseDependency(
        entry.definition as IHook<any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.taskMiddlewares) {
      this.traverseDependency(
        entry.definition as ITaskMiddleware<any, any, any, any>,
        consumerId,
        state,
      );
    }

    for (const entry of accessor.resourceMiddlewares) {
      this.traverseDependency(
        entry.definition as IResourceMiddleware<any, any, any, any>,
        consumerId,
        state,
      );
    }
  }
}
