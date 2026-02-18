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

/**
 * Composes resource initialization chains with validation, interceptors, and middlewares.
 * Builds the onion-style wrapping of resource init functions.
 */
export class ResourceMiddlewareComposer {
  constructor(
    private readonly store: Store,
    private readonly interceptorRegistry: InterceptorRegistry,
    private readonly middlewareResolver: MiddlewareResolver,
  ) {}

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
    // 1. Base init runner with validation
    let runner = this.createBaseInitRunner<TConfig, TValue, TDeps, TContext>(
      resource,
      dependencies,
      context,
    );

    // 2. Apply middlewares
    runner = this.applyMiddlewares<TConfig, TValue>(runner, resource);

    // 3. Apply global resource interceptors
    runner = this.applyGlobalInterceptors<TConfig, TValue>(runner, resource);

    try {
      return await runner(config);
    } catch (error: unknown) {
      await this.reportUnhandledResourceInitError(resource.id, error);
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
        resource.id,
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

    let next = runner;

    for (let i = middlewares.length - 1; i >= 0; i--) {
      const middleware = middlewares[i];
      const storeMiddleware = this.store.resourceMiddlewares.get(
        middleware.id,
      )!;
      const nextFunction = next;

      // Create base middleware runner
      const baseMiddlewareRunner = async (cfg: TConfig) => {
        return storeMiddleware.middleware.run(
          {
            resource: {
              definition: resource,
              config: cfg,
            },
            next: (...args: [TConfig?]) =>
              nextFunction((args.length > 0 ? args[0] : cfg) as TConfig),
          },
          storeMiddleware.computedDependencies,
          middleware.config,
        );
      };

      // Get and apply per-middleware interceptors
      const middlewareInterceptors =
        this.interceptorRegistry.getResourceMiddlewareInterceptors(
          middleware.id,
        );

      next = this.wrapWithInterceptors<TConfig, TValue>(
        baseMiddlewareRunner as (config: TConfig) => TValue,
        middlewareInterceptors,
        resource,
      );
    }

    return next;
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

    const createExecutionInput = (
      config: TConfig,
      nextFunc: (config?: TConfig) => Promise<Awaited<TValue>>,
    ): IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>> => ({
      resource: {
        definition: resource,
        config: config,
      },
      next: nextFunc,
    });

    let currentNext = runner;

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = currentNext;

      currentNext = (async (cfg: TConfig) => {
        const nextForExecutionInput = (
          nextConfig?: TConfig,
        ): Promise<Awaited<TValue>> => {
          const effectiveConfig = nextConfig === undefined ? cfg : nextConfig;
          return nextFunction(effectiveConfig) as Promise<Awaited<TValue>>;
        };
        const executionInput = createExecutionInput(cfg, nextForExecutionInput);
        const wrappedNext = (
          input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
        ): Promise<Awaited<TValue>> => {
          return nextFunction(input.resource.config) as Promise<
            Awaited<TValue>
          >;
        };
        return interceptor(wrappedNext, executionInput) as TValue;
      }) as (config: TConfig) => TValue;
    }

    return currentNext;
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

    let wrapped = middlewareRunner;

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = wrapped;

      wrapped = (async (config: TConfig) => {
        const executionInput: IResourceMiddlewareExecutionInput<
          TConfig,
          Awaited<TValue>
        > = {
          resource: {
            definition: resource,
            config: config,
          },
          next: nextFunction as (
            resourceConfig?: TConfig,
          ) => Promise<Awaited<TValue>>,
        };

        const wrappedNext = (
          input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
        ): Promise<Awaited<TValue>> => {
          return nextFunction(input.resource.config) as Promise<
            Awaited<TValue>
          >;
        };

        return interceptor(wrappedNext, executionInput) as TValue;
      }) as (config: TConfig) => TValue;
    }

    return wrapped;
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
