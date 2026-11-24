import {
  DependencyMapType,
  DependencyValuesType,
  IEvent,
  IEventEmitOptions,
  ITag,
  IResource,
  ITask,
  TagDependencyAccessor,
  ResourceDependencyValuesType,
  TaskCallOptions,
} from "../../defs";
import {
  dependencyNotFoundError,
  eventNotFoundError,
  unknownItemTypeError,
} from "../../errors";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import { Store } from "../store/Store";
import { TaskRunner } from "../TaskRunner";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
} from "../../types/storeTypes";
import * as utils from "../../define";
import { findDependencyStrategy } from "../utils/dependencyStrategies";
import { RuntimeCallSource, runtimeSource } from "../../types/runtimeSource";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
} from "../store/StoreLookup";
import { readDefinitionSourceId } from "./readDefinitionSourceId";
import { ResourceDependencyWrapper } from "./ResourceDependencyWrapper";
import { TagDependencyBuilder } from "./TagDependencyBuilder";

export class DependencyExtractor {
  private readonly inFlightTaskInitializations = new Map<
    string,
    Promise<void>
  >();
  public readonly resourceDependencyWrapper: ResourceDependencyWrapper;
  public readonly tagDependencyBuilder: TagDependencyBuilder;

  constructor(
    private readonly store: Store,
    private readonly eventManager: EventManager,
    private readonly taskRunner: TaskRunner,
    private readonly logger: Logger,
    private readonly ensureResourceInitialized: (
      resource: ResourceStoreElementType<any, any, any>,
    ) => Promise<void>,
  ) {
    this.resourceDependencyWrapper = new ResourceDependencyWrapper(
      store,
      taskRunner,
      (taskId) => this.getStoreTaskOrThrow(taskId),
      (value) => this.resolveDefinitionId(value),
      (sourceId) => this.resolveRuntimeCallSource(sourceId),
    );
    this.tagDependencyBuilder = new TagDependencyBuilder(
      store,
      (value) => this.resolveDefinitionId(value),
      (object, source) => this.extractTaskDependency(object, source),
      this.resourceDependencyWrapper,
    );
  }

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
    return this.resourceDependencyWrapper.wrapResourceDependencies(
      deps,
      extracted,
      ownerResourceId,
    );
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
      return this.eventManager.emit(effectiveEvent, input, {
        source: runtimeCallSource,
        ...(options ?? {}),
      });
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
    return this.tagDependencyBuilder.extractTagDependency(tag, source);
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
