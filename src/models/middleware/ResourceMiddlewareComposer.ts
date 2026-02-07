import { IResource, DependencyMapType } from "../../defs";
import { Store } from "../Store";
import { InterceptorRegistry } from "./InterceptorRegistry";
import { MiddlewareResolver } from "./MiddlewareResolver";
import { ValidationHelper } from "./ValidationHelper";
import { IResourceMiddlewareExecutionInput } from "../../types/resourceMiddleware";

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
    dependencies: any,
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

    return runner(config);
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
    dependencies: any,
    context: TContext,
  ): (config: TConfig) => TValue {
    return (async (config: TConfig) => {
      if (!resource.init) {
        return undefined as unknown as TValue;
      }

      const rawValue = await resource.init(config, dependencies, context);

      return ValidationHelper.validateResult(
        rawValue,
        resource.resultSchema,
        resource.id,
        "Resource",
      ) as unknown as Awaited<TValue>;
    }) as unknown as (config: TConfig) => TValue;
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

      // Create base middleware runner with error handling
      const baseMiddlewareRunner = async (cfg: any) => {
        try {
          return await storeMiddleware.middleware.run(
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
        } catch (error: unknown) {
          try {
            await this.store.onUnhandledError({
              error,
              kind: "resourceInit",
              source: resource.id,
            });
          } catch (_) {
            // Ignore errors from error handler
          }
          throw error;
        }
      };

      // Get and apply per-middleware interceptors
      const middlewareInterceptors =
        this.interceptorRegistry.getResourceMiddlewareInterceptors(
          middleware.id,
        );

      next = this.wrapWithInterceptors<TConfig, TValue>(
        baseMiddlewareRunner as any,
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
      config: any,
      nextFunc: any,
    ): IResourceMiddlewareExecutionInput<any> => ({
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
        const executionInput = createExecutionInput(cfg, nextFunction);
        const wrappedNext = (
          input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
        ): Promise<Awaited<TValue>> => {
          return nextFunction(input.resource.config) as any;
        };
        return (interceptor as any)(wrappedNext, executionInput);
      }) as unknown as (config: TConfig) => TValue;
    }

    return currentNext;
  }

  /**
   * Wraps a middleware runner with its specific interceptors in onion style
   */
  private wrapWithInterceptors<TConfig, TValue extends Promise<any>>(
    middlewareRunner: (config: TConfig) => TValue,
    interceptors: readonly any[],
    resource: IResource<TConfig, TValue, any, any>,
  ): (config: TConfig) => TValue {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }

    const reversedInterceptors = [...interceptors].reverse();
    let wrapped = middlewareRunner;

    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
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
          next: nextFunction as any,
        };

        const wrappedNext = (
          input: IResourceMiddlewareExecutionInput<TConfig, Awaited<TValue>>,
        ): Promise<Awaited<TValue>> => {
          return nextFunction(input.resource.config) as any;
        };

        return (interceptor as any)(wrappedNext, executionInput);
      }) as unknown as (config: TConfig) => TValue;
    }

    return wrapped;
  }
}
