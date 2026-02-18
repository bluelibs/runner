import {
  DependencyMapType,
  DependencyValuesType,
  IEvent,
  IEventEmitOptions,
  IResource,
  ITask,
  ResourceDependencyValuesType,
  TaskCallOptions,
  TaskDependencyWithIntercept,
  TaskLocalInterceptor,
} from "../../defs";
import { dependencyNotFoundError, unknownItemTypeError } from "../../errors";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import { Store } from "../Store";
import { TaskRunner } from "../TaskRunner";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
} from "../../types/storeTypes";
import * as utils from "../../define";
import { findDependencyStrategy } from "../utils/dependencyStrategies";

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
  ): ResourceDependencyValuesType<TD> {
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(deps) as Array<keyof TD>) {
      const original = deps[key];
      const value = (extracted as Record<string, unknown>)[key as string];
      if (utils.isOptional(original)) {
        const inner = (original as { inner: unknown }).inner;
        if (utils.isTask(inner)) {
          wrapped[key as string] = value
            ? this.makeTaskWithIntercept(inner)
            : undefined;
        } else {
          wrapped[key as string] = value as unknown;
        }
        continue;
      }
      if (utils.isTask(original)) {
        wrapped[key as string] = this.makeTaskWithIntercept(original);
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
      try {
        object[key] = await this.extractDependency(map[key], source);
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
    return async (input: any, options?: IEventEmitOptions) => {
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

  private makeTaskWithIntercept<
    I,
    O extends Promise<any>,
    D extends DependencyMapType,
  >(original: ITask<I, O, D>): TaskDependencyWithIntercept<I, O> {
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
        storeTask.interceptors.push(middleware);
      },
    }) as TaskDependencyWithIntercept<I, O>;
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
