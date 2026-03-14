import {
  DependencyMapType,
  DependencyValuesType,
  ExtractTaskInput,
  ExtractTaskOutput,
  IEvent,
  IEventEmitOptions,
  ITag,
  IResourceMiddleware,
  IResource,
  ITaskMiddleware,
  ITask,
  TagDependencyAccessor,
  ResourceDependencyValuesType,
  TaskCallOptions,
  TaskDependency,
  TaskDependencyWithIntercept,
  TaskLocalInterceptor,
  TaggedTask,
} from "../../defs";
import {
  dependencyNotFoundError,
  eventNotFoundError,
  interceptAfterLockError,
  unknownItemTypeError,
} from "../../errors";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import { Store } from "../Store";
import { TaskRunner } from "../TaskRunner";
import {
  ResourceStoreElementType,
  TaskLocalInterceptorRecord,
  TaskStoreElementType,
} from "../../types/storeTypes";
import * as utils from "../../define";
import { findDependencyStrategy } from "../utils/dependencyStrategies";
import type { MiddlewareManager } from "../MiddlewareManager";
import type {
  ResourceMiddlewareInterceptor,
  TaskMiddlewareInterceptor,
} from "../middleware/types";
import { RuntimeCallSource, runtimeSource } from "../../types/runtimeSource";
import { globalResources } from "../../globals/globalResources";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
} from "../StoreLookup";

const MIDDLEWARE_MANAGER_RESOURCE_ID = globalResources.middlewareManager.id;

function readDefinitionSourceId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (utils.isResourceWithConfig(value)) {
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

export class DependencyExtractor {
  private readonly inFlightTaskInitializations = new Map<
    string,
    Promise<void>
  >();

  constructor(
    private readonly store: Store,
    private readonly eventManager: EventManager,
    private readonly taskRunner: TaskRunner,
    private readonly logger: Logger,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
    ) => Promise<void>,
  ) {}

  async ensureTaskPrepared(
    task: TaskStoreElementType<any, any, any>,
  ): Promise<void> {
    if (task.isInitialized) {
      return;
    }

    let initPromise = this.inFlightTaskInitializations.get(task.task.id);
    if (!initPromise) {
      initPromise = (async () => {
        const dependencies = task.task.dependencies as DependencyMapType;
        task.computedDependencies = await this.extractDependencies(
          dependencies,
          task.task.id,
        );
        task.isInitialized = true;
      })().finally(() => {
        this.inFlightTaskInitializations.delete(task.task.id);
      });
      this.inFlightTaskInitializations.set(task.task.id, initPromise);
    }

    await initPromise;
  }

  wrapResourceDependencies<TD extends DependencyMapType>(
    deps: TD,
    extracted: DependencyValuesType<TD>,
    ownerResourceId: string,
  ): ResourceDependencyValuesType<TD> {
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(deps) as Array<keyof TD>) {
      const original = deps[key];
      const value = (extracted as Record<string, unknown>)[key as string];
      wrapped[key as string] = this.decorateResourceDependency(
        original,
        value,
        ownerResourceId,
      );
    }
    return wrapped as ResourceDependencyValuesType<TD>;
  }

  private decorateResourceDependency(
    original: unknown,
    extracted: unknown,
    ownerResourceId: string,
  ): unknown {
    const dependency = utils.isOptional(original) ? original.inner : original;

    if (utils.isTask(dependency)) {
      return extracted === undefined
        ? undefined
        : this.makeTaskWithIntercept(dependency, ownerResourceId);
    }

    if (
      utils.isResource(dependency) &&
      dependency.id === MIDDLEWARE_MANAGER_RESOURCE_ID
    ) {
      return this.makeOwnerAwareMiddlewareManager(extracted, ownerResourceId);
    }

    return extracted;
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string,
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    await Promise.all(
      Object.entries(map).map(async ([key, dependency]) => {
        if (dependency === undefined) {
          return;
        }

        try {
          const extracted = await this.extractDependency(dependency, source);
          object[key as keyof T] = extracted as any;
          const val = extracted as unknown;
          if (val instanceof Logger) {
            (object as Record<string, unknown>)[key] = val.with({ source });
          }
        } catch (e) {
          const errorMessage = String(e);
          this.logger.error(
            `Failed to extract dependency from source: ${source} -> ${key} with error: ${errorMessage}`,
          );

          throw e;
        }
      }),
    );
    this.logger.trace(`Finished computing dependencies for source: ${source}`);

    return object;
  }

  async extractDependency(object: unknown, source: string) {
    this.logger.trace(
      `Extracting dependency -> ${source} -> ${(object as { id?: string })?.id}`,
    );

    let isOpt = false;
    let item: unknown = object;

    if (utils.isOptional(object)) {
      isOpt = true;
      item = object.inner;
    }

    if (utils.isTagStartup(item)) {
      item = item.tag;
    }

    const strategy = findDependencyStrategy(item);
    if (!strategy) {
      return unknownItemTypeError.throw({ item });
    }
    const resolvedItemId = this.resolveDefinitionId(item);

    if (isOpt) {
      const exists = strategy.getStoreMap(this.store).has(resolvedItemId);
      if (!exists) return undefined;
    }

    if (utils.isResource(item)) return this.extractResourceDependency(item);
    if (utils.isTask(item)) return this.extractTaskDependency(item, source);
    if (utils.isEvent(item)) return this.extractEventDependency(item, source);
    if (utils.isTag(item)) return this.extractTagDependency(item, source);

    if (!isOpt) {
      const exists = strategy.getStoreMap(this.store).has(resolvedItemId);
      if (!exists) {
        const label = utils.isError(item) ? "Error" : "AsyncContext";
        dependencyNotFoundError.throw({ key: `${label} ${resolvedItemId}` });
      }
    }

    return item;
  }

  extractEventDependency(object: IEvent<any>, source: string) {
    const runtimeCallSource = this.resolveRuntimeCallSource(source);
    const eventId = this.resolveDefinitionId(object);
    if (!eventId) {
      return dependencyNotFoundError.throw({ key: `Event ${object.id}` });
    }

    const eventEntry = this.store.events.get(eventId);
    if (!eventEntry) {
      return eventNotFoundError.throw({ id: eventId });
    }

    const effectiveEvent = eventEntry.event;

    return async (input: unknown, options?: IEventEmitOptions) => {
      return this.eventManager.emit(
        effectiveEvent,
        input,
        runtimeCallSource,
        options,
      );
    };
  }

  async extractTaskDependency(object: ITask<any, any, {}>, source?: string) {
    const taskId = this.resolveDefinitionId(object);
    const storeTask = this.store.tasks.get(taskId);
    if (storeTask === undefined) {
      dependencyNotFoundError.throw({ key: `Task ${taskId}` });
    }

    const st = storeTask!;
    await this.ensureTaskPrepared(st);

    const runtimeCallSource = this.resolveRuntimeCallSource(
      source ?? st.task.id,
    );
    return (input?: unknown, options?: TaskCallOptions) => {
      return this.taskRunner.run(st.task, input, {
        ...(options ?? {}),
        source: runtimeCallSource,
      });
    };
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    const resourceId = this.resolveDefinitionId(object);
    const storeResource = this.store.resources.get(resourceId);
    if (storeResource === undefined) {
      dependencyNotFoundError.throw({ key: `Resource ${resourceId}` });
    }

    const sr = storeResource!;
    await this.ensureResourceInitialized(sr);

    return sr.value;
  }

  async extractTagDependency<TTag extends ITag<any, any, any>>(
    tag: TTag,
    source: string,
  ): Promise<TagDependencyAccessor<TTag>> {
    const tagId = this.resolveDefinitionId(tag);
    if (!this.store.tags.has(tagId)) {
      dependencyNotFoundError.throw({ key: `Tag ${tagId}` });
    }

    const effectiveTag = this.store.tags.get(tagId)! as TTag;
    const baseAccessor = this.store.getTagAccessor(effectiveTag, {
      consumerId: source,
      includeSelf: false,
    });
    const ownerResourceId = this.store.resources.has(source)
      ? source
      : undefined;

    let tasksCache: TagDependencyAccessor<TTag>["tasks"] | undefined;
    let resourcesCache: TagDependencyAccessor<TTag>["resources"] | undefined;

    const readTasks = (): TagDependencyAccessor<TTag>["tasks"] => {
      if (!tasksCache) {
        tasksCache = Object.freeze(
          baseAccessor.tasks.map((entry) => ({
            definition: entry.definition,
            config: entry.config,
            run: this.createTaggedTaskRunner(entry.definition, source),
            ...(ownerResourceId
              ? this.createTaggedTaskInterceptHelpers(
                  entry.definition,
                  ownerResourceId,
                )
              : {}),
          })),
        );
      }
      return tasksCache;
    };

    const readResources = (): TagDependencyAccessor<TTag>["resources"] => {
      if (!resourcesCache) {
        resourcesCache = Object.freeze(
          baseAccessor.resources.map((entry) =>
            this.createRuntimeTaggedResourceMatch(entry),
          ),
        );
      }
      return resourcesCache;
    };

    const accessor: TagDependencyAccessor<TTag> = {
      get tasks() {
        return readTasks();
      },
      get resources() {
        return readResources();
      },
      get events() {
        return baseAccessor.events;
      },
      get hooks() {
        return baseAccessor.hooks;
      },
      get taskMiddlewares() {
        return baseAccessor.taskMiddlewares;
      },
      get resourceMiddlewares() {
        return baseAccessor.resourceMiddlewares;
      },
      get errors() {
        return baseAccessor.errors;
      },
    };

    return Object.freeze(accessor);
  }

  private createTaggedTaskRunner<TTask extends TaggedTask<any>>(
    task: TTask,
    source: string,
  ): TaskDependency<ExtractTaskInput<TTask>, ExtractTaskOutput<TTask>> {
    let cachedRunner:
      | ((
          input: ExtractTaskInput<TTask>,
          options?: TaskCallOptions,
        ) => ExtractTaskOutput<TTask>)
      | undefined;

    const ensureRunner = async () => {
      if (!cachedRunner) {
        cachedRunner = (await this.extractTaskDependency(
          task as ITask<any, any, {}>,
          source,
        )) as (
          input: ExtractTaskInput<TTask>,
          options?: TaskCallOptions,
        ) => ExtractTaskOutput<TTask>;
      }
      return cachedRunner;
    };

    return (async (
      input?: ExtractTaskInput<TTask>,
      options?: TaskCallOptions,
    ) => {
      const runner = await ensureRunner();
      return runner(input as ExtractTaskInput<TTask>, options);
    }) as TaskDependency<ExtractTaskInput<TTask>, ExtractTaskOutput<TTask>>;
  }

  private createTaggedTaskInterceptHelpers<TTask extends TaggedTask<any>>(
    task: TTask,
    ownerResourceId: string,
  ): Pick<
    TagDependencyAccessor<ITag<any, any, any>>["tasks"][number],
    "intercept" | "getInterceptingResourceIds"
  > {
    const withIntercept = this.makeTaskWithIntercept(
      task as unknown as ITask<any, any, any>,
      ownerResourceId,
    );

    return {
      intercept: withIntercept.intercept,
      getInterceptingResourceIds: withIntercept.getInterceptingResourceIds,
    };
  }

  private createRuntimeTaggedResourceMatch<TTag extends ITag<any, any, any>>(
    entry: TagDependencyAccessor<TTag>["resources"][number],
  ): TagDependencyAccessor<TTag>["resources"][number] {
    const resourceId = entry.definition.id;
    const store = this.store;
    return {
      definition: entry.definition,
      config: entry.config,
      get value() {
        const storeResource = store.resources.get(resourceId);
        if (!storeResource || !storeResource.isInitialized) {
          return undefined;
        }

        return storeResource.value as TagDependencyAccessor<TTag>["resources"][number]["value"];
      },
    };
  }

  private makeTaskWithIntercept<
    I,
    O extends Promise<any>,
    D extends DependencyMapType,
  >(
    original: ITask<I, O, D>,
    ownerResourceId: string,
  ): TaskDependencyWithIntercept<I, O> {
    const taskId = this.store.findIdByDefinition(original);
    const fn: (input: I, options?: TaskCallOptions) => O = (input, options) => {
      const storeTask = this.getStoreTaskOrThrow(taskId);
      const effective = storeTask.task as ITask<I, O, D>;
      const runtimeCallSource = this.resolveRuntimeCallSource(ownerResourceId);

      return this.taskRunner.run(effective, input, {
        ...(options || {}),
        source: runtimeCallSource,
      }) as O;
    };
    return Object.assign(fn, {
      intercept: (middleware: TaskLocalInterceptor<I, O>) => {
        // Fail-fast: interceptors are a registration-phase action. Post-lock,
        // cached runners would miss this interceptor, creating silent inconsistency.
        if (this.store.isLocked) {
          interceptAfterLockError.throw({
            taskId: this.resolveDefinitionId(taskId),
            source: this.resolveDefinitionId(ownerResourceId),
          });
        }
        const storeTask = this.getStoreTaskOrThrow(taskId);

        if (!storeTask.interceptors) storeTask.interceptors = [];
        storeTask.interceptors.push({
          interceptor: middleware,
          ownerResourceId,
        } satisfies TaskLocalInterceptorRecord<I, O>);
      },
      getInterceptingResourceIds: () => {
        const storeTask = this.getStoreTaskOrThrow(taskId);
        const interceptors = storeTask.interceptors ?? [];
        const ownerIds = new Set<string>();
        for (const interceptor of interceptors) {
          if (interceptor.ownerResourceId) {
            ownerIds.add(this.resolveDefinitionId(interceptor.ownerResourceId));
          }
        }
        return Object.freeze(Array.from(ownerIds));
      },
    }) as TaskDependencyWithIntercept<I, O>;
  }

  private makeOwnerAwareMiddlewareManager(
    value: unknown,
    ownerResourceId: string,
  ): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    const middlewareManager = value as MiddlewareManager;
    const canonicalOwnerResourceId = this.resolveDefinitionId(ownerResourceId);
    if (
      typeof middlewareManager.interceptOwned !== "function" ||
      typeof middlewareManager.interceptMiddlewareOwned !== "function"
    ) {
      return value;
    }

    return new Proxy(middlewareManager, {
      get(target, prop, receiver) {
        if (prop === "intercept") {
          return (
            kind: "task" | "resource",
            interceptor:
              | TaskMiddlewareInterceptor
              | ResourceMiddlewareInterceptor,
          ) => {
            if (kind === "task") {
              target.interceptOwned(
                "task",
                interceptor as TaskMiddlewareInterceptor,
                canonicalOwnerResourceId,
              );
              return;
            }

            target.interceptOwned(
              "resource",
              interceptor as ResourceMiddlewareInterceptor,
              canonicalOwnerResourceId,
            );
          };
        }

        if (prop === "interceptMiddleware") {
          return (
            middleware:
              | ITaskMiddleware<any, any, any, any>
              | IResourceMiddleware<any, any, any, any>,
            interceptor:
              | TaskMiddlewareInterceptor
              | ResourceMiddlewareInterceptor,
          ) => {
            if (utils.isTaskMiddleware(middleware)) {
              target.interceptMiddlewareOwned(
                middleware,
                interceptor as TaskMiddlewareInterceptor,
                canonicalOwnerResourceId,
              );
              return;
            }

            if (utils.isResourceMiddleware(middleware)) {
              target.interceptMiddlewareOwned(
                middleware,
                interceptor as ResourceMiddlewareInterceptor,
                canonicalOwnerResourceId,
              );
            }
          };
        }

        const originalValue = Reflect.get(target, prop, receiver);
        if (typeof originalValue === "function") {
          return originalValue.bind(target);
        }
        return originalValue;
      },
    });
  }

  private getStoreTaskOrThrow(
    taskId: string,
  ): TaskStoreElementType<any, any, any> {
    const storeTask = this.store.tasks.get(taskId);
    if (storeTask === undefined) {
      return dependencyNotFoundError.throw({ key: `Task ${taskId}` });
    }
    return storeTask;
  }

  private resolveDefinitionId(value: unknown): string {
    return (
      resolveCanonicalIdFromStore(this.store, value) ??
      extractRequestedId(value) ??
      readDefinitionSourceId(value) ??
      String(value)
    );
  }

  private resolveRuntimeCallSource(sourceId: string): RuntimeCallSource {
    if (this.store.tasks.has(sourceId)) {
      return runtimeSource.task(sourceId);
    }
    if (this.store.hooks.has(sourceId)) {
      return runtimeSource.hook(sourceId);
    }
    if (
      this.store.taskMiddlewares.has(sourceId) ||
      this.store.resourceMiddlewares.has(sourceId)
    ) {
      return this.store.taskMiddlewares.has(sourceId)
        ? runtimeSource.taskMiddleware(sourceId)
        : runtimeSource.resourceMiddleware(sourceId);
    }
    if (this.store.resources.has(sourceId)) {
      return runtimeSource.resource(sourceId);
    }
    return runtimeSource.runtime(sourceId);
  }
}
