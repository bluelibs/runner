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
import { dependencyNotFoundError, unknownItemTypeError } from "../../errors";
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

const MIDDLEWARE_MANAGER_RESOURCE_ID = "globals.resources.middlewareManager";

export class DependencyExtractor {
  constructor(
    private readonly store: Store,
    private readonly eventManager: EventManager,
    private readonly taskRunner: TaskRunner,
    private readonly logger: Logger,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
    ) => Promise<void>,
  ) {}

  wrapResourceDependencies<TD extends DependencyMapType>(
    deps: TD,
    extracted: DependencyValuesType<TD>,
    ownerResourceId: string,
  ): ResourceDependencyValuesType<TD> {
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(deps) as Array<keyof TD>) {
      const original = deps[key];
      const value = (extracted as Record<string, unknown>)[key as string];
      if (utils.isOptional(original)) {
        const inner = (original as { inner: unknown }).inner;
        if (utils.isTask(inner)) {
          wrapped[key as string] = value
            ? this.makeTaskWithIntercept(inner, ownerResourceId)
            : undefined;
        } else if (
          utils.isResource(inner) &&
          inner.id === MIDDLEWARE_MANAGER_RESOURCE_ID
        ) {
          wrapped[key as string] = this.makeOwnerAwareMiddlewareManager(
            value,
            ownerResourceId,
          );
        } else {
          wrapped[key as string] = value as unknown;
        }
        continue;
      }
      if (utils.isTask(original)) {
        wrapped[key as string] = this.makeTaskWithIntercept(
          original,
          ownerResourceId,
        );
      } else if (
        utils.isResource(original) &&
        original.id === MIDDLEWARE_MANAGER_RESOURCE_ID
      ) {
        wrapped[key as string] = this.makeOwnerAwareMiddlewareManager(
          value,
          ownerResourceId,
        );
      } else {
        wrapped[key as string] = value as unknown;
      }
    }
    return wrapped as ResourceDependencyValuesType<TD>;
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string,
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    for (const key in map) {
      const dependency = map[key];
      if (dependency === undefined) {
        continue;
      }

      try {
        object[key] = await this.extractDependency(dependency, source);
        const val = object[key] as unknown;
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
    }
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

    const itemWithId = item as { id: string };
    const strategy = findDependencyStrategy(item);
    if (!strategy) {
      return unknownItemTypeError.throw({ item });
    }

    if (isOpt) {
      const exists = strategy.getStoreMap(this.store).has(itemWithId.id);
      if (!exists) return undefined;
    }

    if (utils.isResource(item)) return this.extractResourceDependency(item);
    if (utils.isTask(item)) return this.extractTaskDependency(item);
    if (utils.isEvent(item)) return this.extractEventDependency(item, source);
    if (utils.isTag(item)) return this.extractTagDependency(item, source);

    if (!isOpt) {
      const exists = strategy.getStoreMap(this.store).has(itemWithId.id);
      if (!exists) {
        const label = utils.isError(item) ? "Error" : "AsyncContext";
        dependencyNotFoundError.throw({ key: `${label} ${itemWithId.id}` });
      }
    }

    return item;
  }

  extractEventDependency(object: IEvent<any>, source: string) {
    return async (input: unknown, options?: IEventEmitOptions) => {
      return this.eventManager.emit(object, input, source, options);
    };
  }

  async extractTaskDependency(object: ITask<any, any, {}>) {
    const storeTask = this.store.tasks.get(object.id);
    if (storeTask === undefined) {
      dependencyNotFoundError.throw({ key: `Task ${object.id}` });
    }

    const st = storeTask!;
    if (!st.isInitialized) {
      const dependencies = st.task.dependencies as DependencyMapType;

      st.computedDependencies = await this.extractDependencies(
        dependencies,
        st.task.id,
      );
      st.isInitialized = true;
    }

    return (input: unknown, options?: TaskCallOptions) => {
      return this.taskRunner.run(st.task, input, options);
    };
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    const storeResource = this.store.resources.get(object.id);
    if (storeResource === undefined) {
      dependencyNotFoundError.throw({ key: `Resource ${object.id}` });
    }

    const sr = storeResource!;
    await this.ensureResourceInitialized(sr);

    return sr.value;
  }

  async extractTagDependency<TTag extends ITag<any, any, any>>(
    tag: TTag,
    source: string,
  ): Promise<TagDependencyAccessor<TTag>> {
    if (!this.store.tags.has(tag.id)) {
      dependencyNotFoundError.throw({ key: `Tag ${tag.id}` });
    }

    const baseAccessor = this.store.getTagAccessor(tag, {
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
            run: this.createTaggedTaskRunner(entry.definition),
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
        )) as (
          input: ExtractTaskInput<TTask>,
          options?: TaskCallOptions,
        ) => ExtractTaskOutput<TTask>;
      }
      return cachedRunner;
    };

    return (async (
      input: ExtractTaskInput<TTask>,
      options?: TaskCallOptions,
    ) => {
      const runner = await ensureRunner();
      return runner(input, options);
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
    const taskId = original.id;
    const fn: (input: I, options?: TaskCallOptions) => O = (input, options) => {
      const storeTask = this.getStoreTaskOrThrow(taskId);
      const effective: ITask<I, O, D> = storeTask.task;

      return this.taskRunner.run(effective, input, options) as O;
    };
    return Object.assign(fn, {
      intercept: (middleware: TaskLocalInterceptor<I, O>) => {
        this.store.checkLock();
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
            ownerIds.add(interceptor.ownerResourceId);
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
                ownerResourceId,
              );
              return;
            }

            target.interceptOwned(
              "resource",
              interceptor as ResourceMiddlewareInterceptor,
              ownerResourceId,
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
                ownerResourceId,
              );
              return;
            }

            if (utils.isResourceMiddleware(middleware)) {
              target.interceptMiddlewareOwned(
                middleware,
                interceptor as ResourceMiddlewareInterceptor,
                ownerResourceId,
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
}
