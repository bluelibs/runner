import {
  IResource,
  DependencyMapType,
  ResourceDependencyValuesType,
} from "../../defs";
import { Store } from "../Store";
import { InterceptorRegistry } from "./InterceptorRegistry";
import { MiddlewareResolver } from "./MiddlewareResolver";
import { ValidationHelper } from "./ValidationHelper";
import { IResourceMiddlewareExecutionInput } from "../../types/resourceMiddleware";
import type { ResourceMiddlewareInterceptor } from "./types";
import { LifecycleAdmissionController } from "../runtime/LifecycleAdmissionController";
import { runtimeSource } from "../../types/runtimeSource";
import { runWithRuntimeCallSource } from "../RuntimeCallSourceStore";
import { composeReverseLayers } from "./composeLayers";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../StoreLookup";

/**
 * Composes resource initialization chains with validation, interceptors, and middlewares.
 * Builds the onion-style wrapping of resource init functions.
 */
export class ResourceMiddlewareComposer {
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;

  constructor(
    private readonly store: Store,
    private readonly interceptorRegistry: InterceptorRegistry,
    private readonly middlewareResolver: MiddlewareResolver,
  ) {
    this.lifecycleAdmissionController =
      this.store.getLifecycleAdmissionController();
  }

  private resolveDefinitionId(reference: unknown): string {
    return (
      resolveCanonicalIdFromStore(this.store, reference) ??
      extractRequestedId(reference) ??
      String(reference)
    );
  }

  private toCanonicalDefinition<TDefinition extends { id: string }>(
    definition: TDefinition,
  ): TDefinition {
    return toCanonicalDefinitionFromStore(this.store, definition);
  }

  /**
   * Runs resource initialization with all middleware and interceptors applied
   */
  async runInit<
    TConfig,
    TValue extends Promise<any>,
    TDeps extends DependencyMapType,
    TContext,
  >(
    resource: IResource<TConfig, TValue, TDeps, TContext>,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDeps>,
    context: TContext,
  ): Promise<TValue | undefined> {
    const resourceId = this.resolveDefinitionId(resource);
    const storedResource = this.store.resources.get(resourceId);
    const effectiveResource = (storedResource?.resource ??
      resource) as IResource<TConfig, TValue, TDeps, TContext>;

    // 1. Base init runner with validation
    let runner = this.createBaseInitRunner<TConfig, TValue, TDeps, TContext>(
      effectiveResource,
      dependencies,
      context,
    );

    // 2. Apply middlewares
    runner = this.applyMiddlewares<TConfig, TValue>(runner, effectiveResource);

    // 3. Apply global resource interceptors
    runner = this.applyGlobalInterceptors<TConfig, TValue>(
      runner,
      effectiveResource,
    );

    try {
      return await runner(config);
    } catch (error: unknown) {
      await this.reportUnhandledResourceInitError(effectiveResource.id, error);
      throw error;
    }
  }

  /**
   * Creates the base resource init runner with result validation
   */
  private createBaseInitRunner<
    TConfig,
    TValue extends Promise<any>,
    TDeps extends DependencyMapType,
    TContext,
  >(
    resource: IResource<TConfig, TValue, TDeps, TContext>,
    dependencies: ResourceDependencyValuesType<TDeps>,
    context: TContext,
  ): (config: TConfig) => TValue {
    return (async (config: TConfig) => {
      if (!resource.init) {
        return undefined;
      }

      const rawValue = await resource.init(config, dependencies, context);

      return ValidationHelper.validateResult(
        rawValue,
        resource.resultSchema,
        this.resolveDefinitionId(resource),
        "Resource",
      ) as Awaited<TValue>;
    }) as (config: TConfig) => TValue;
  }

  /**
   * Applies resource middleware layers
   */
  private applyMiddlewares<TConfig, TValue extends Promise<any>>(
    runner: (config: TConfig) => TValue,
    resource: IResource<TConfig, TValue, any, any>,
  ): (config: TConfig) => TValue {
    const middlewares =
      this.middlewareResolver.getApplicableResourceMiddlewares(resource);

    if (middlewares.length === 0) {
      return runner;
    }

    const canonicalResourceDefinition = this.toCanonicalDefinition(resource);

    return composeReverseLayers(
      runner,
      middlewares,
      (nextFunction, middleware) => {
        const middlewareId = this.resolveDefinitionId(middleware);
        const storeMiddleware =
          this.store.resourceMiddlewares.get(middlewareId)!;
        const middlewareSource = runtimeSource.resourceMiddleware(middlewareId);

        const baseMiddlewareRunner = async (cfg: TConfig) => {
          return this.lifecycleAdmissionController.trackMiddlewareExecution(
            middlewareSource,
            () =>
              runWithRuntimeCallSource(middlewareSource, () =>
                storeMiddleware.middleware.run(
                  {
                    resource: {
                      definition: canonicalResourceDefinition,
                      config: cfg,
                    },
                    next: (...args: [TConfig?]) =>
                      nextFunction(
                        (args.length > 0 ? args[0] : cfg) as TConfig,
                      ),
                  },
                  storeMiddleware.computedDependencies,
                  middleware.config,
                ),
              ),
          );
        };

        const middlewareInterceptors =
          this.interceptorRegistry.getResourceMiddlewareInterceptors(
            middlewareId,
          );

        return this.wrapWithInterceptors<TConfig, TValue>(
          baseMiddlewareRunner as (config: TConfig) => TValue,
          middlewareInterceptors,
          resource,
        );
      },
    );
  }

  /**
   * Applies global resource middleware interceptors
   */
  private applyGlobalInterceptors<TConfig, TValue extends Promise<any>>(
    runner: (config: TConfig) => TValue,
    resource: IResource<TConfig, TValue, any, any>,
  ): (config: TConfig) => TValue {
    const interceptors =
      this.interceptorRegistry.getGlobalResourceInterceptors();

    if (interceptors.length === 0) {
      return runner;
    }
    const canonicalResourceDefinition = this.toCanonicalDefinition(resource);

    const createExecutionInput = (
      config: TConfig,
      nextFunc: (...args: [config?: TConfig]) => Promise<Awaited<TValue>>,
    ): IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>> => ({
      resource: {
        definition: canonicalResourceDefinition,
        config: config,
      },
      next: nextFunc,
    });

    return composeReverseLayers(
      runner,
      interceptors,
      (nextFunction, interceptor) =>
        (async (cfg: TConfig) => {
          const nextForExecutionInput = (
            ...args: [nextConfig?: TConfig]
          ): Promise<Awaited<TValue>> =>
            nextFunction(
              (args.length > 0 ? args[0] : cfg) as TConfig,
            ) as Promise<Awaited<TValue>>;
          const executionInput = createExecutionInput(
            cfg,
            nextForExecutionInput,
          );
          const wrappedNext = (
            input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
          ): Promise<Awaited<TValue>> => {
            return nextFunction(input.resource.config) as Promise<
              Awaited<TValue>
            >;
          };
          return interceptor(wrappedNext, executionInput) as TValue;
        }) as (config: TConfig) => TValue,
    );
  }

  /**
   * Wraps a middleware runner with its specific interceptors in onion style
   */
  private wrapWithInterceptors<TConfig, TValue extends Promise<any>>(
    middlewareRunner: (config: TConfig) => TValue,
    interceptors: readonly ResourceMiddlewareInterceptor[],
    resource: IResource<TConfig, TValue, any, any>,
  ): (config: TConfig) => TValue {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }
    const canonicalResourceDefinition = this.toCanonicalDefinition(resource);

    return composeReverseLayers(
      middlewareRunner,
      interceptors,
      (nextFunction, interceptor) =>
        (async (config: TConfig) => {
          const nextForExecutionInput = (
            ...args: [resourceConfig?: TConfig]
          ): Promise<Awaited<TValue>> =>
            nextFunction(
              (args.length > 0 ? args[0] : config) as TConfig,
            ) as Promise<Awaited<TValue>>;

          const executionInput: IResourceMiddlewareExecutionInput<
            TConfig,
            Awaited<TValue>
          > = {
            resource: {
              definition: canonicalResourceDefinition,
              config: config,
            },
            next: nextForExecutionInput,
          };

          const wrappedNext = (
            input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
          ): Promise<Awaited<TValue>> => {
            return nextFunction(input.resource.config) as Promise<
              Awaited<TValue>
            >;
          };

          return interceptor(wrappedNext, executionInput) as TValue;
        }) as (config: TConfig) => TValue,
    );
  }

  private async reportUnhandledResourceInitError(
    source: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.store.onUnhandledError({
        error,
        kind: "resourceInit",
        source,
      });
    } catch (_) {
      // Ignore errors from error handler
    }
  }
}
