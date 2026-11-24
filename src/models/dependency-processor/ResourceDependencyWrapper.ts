import {
  DependencyMapType,
  DependencyValuesType,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
  ResourceDependencyValuesType,
  TaskCallOptions,
  TaskDependencyWithIntercept,
  TaskLocalInterceptor,
} from "../../defs";
import { interceptAfterLockError } from "../../errors";
import * as utils from "../../define";
import { globalResources } from "../../globals/globalResources";
import type { MiddlewareManager } from "../MiddlewareManager";
import type {
  ResourceMiddlewareInterceptor,
  TaskMiddlewareInterceptor,
} from "../middleware/types";
import type { Store } from "../store/Store";
import type { TaskRunner } from "../TaskRunner";
import type { RuntimeCallSource } from "../../types/runtimeSource";
import type {
  TaskLocalInterceptorRecord,
  TaskStoreElementType,
} from "../../types/storeTypes";

const MIDDLEWARE_MANAGER_RESOURCE_ID = globalResources.middlewareManager.id;

/**
 * Decorates extracted resource dependencies with owner-aware task interceptors
 * and middleware-manager proxy bindings.
 */
export class ResourceDependencyWrapper {
  constructor(
    private readonly store: Store,
    private readonly taskRunner: TaskRunner,
    private readonly getStoreTaskOrThrow: (
      taskId: string,
    ) => TaskStoreElementType<any, any, any>,
    private readonly resolveDefinitionId: (value: unknown) => string,
    private readonly resolveRuntimeCallSource: (
      sourceId: string,
    ) => RuntimeCallSource,
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

  makeTaskWithIntercept<I, O extends Promise<any>, D extends DependencyMapType>(
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

  makeOwnerAwareMiddlewareManager(
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
}
