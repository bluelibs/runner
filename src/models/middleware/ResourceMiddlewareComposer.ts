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
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext,
  >(
    resource: IResource<C, V, D, TContext>,
    config: C,
    dependencies: any,
    context: TContext,
  ): Promise<V | undefined> {
    // 1. Base init runner with validation
    let runner = this.createBaseInitRunner(resource, dependencies, context);

    // 2. Apply middlewares
    runner = this.applyMiddlewares(runner, resource);

    // 3. Apply global resource interceptors
    runner = this.applyGlobalInterceptors(runner, resource);

    return runner(config);
  }

  /**
   * Creates the base resource init runner with result validation
   */
  private createBaseInitRunner<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext,
  >(
    resource: IResource<C, V, D, TContext>,
    dependencies: any,
    context: TContext,
  ): (config: C) => Promise<V | undefined> {
    return async (config: C) => {
      if (!resource.init) {
        return undefined as unknown as V;
      }

      const rawValue = await resource.init(config, dependencies, context);

      return ValidationHelper.validateResult(
        rawValue,
        resource.resultSchema,
        resource.id,
        "Resource",
      );
    };
  }

  /**
   * Applies resource middleware layers
   */
  private applyMiddlewares(
    runner: (config: any) => Promise<any>,
    resource: IResource<any, any, any, any>,
  ): (config: any) => Promise<any> {
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
              next: nextFunction,
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

      next = this.wrapWithInterceptors(
        baseMiddlewareRunner,
        middlewareInterceptors,
      );
    }

    return next;
  }

  /**
   * Applies global resource middleware interceptors
   */
  private applyGlobalInterceptors(
    runner: (config: any) => Promise<any>,
    resource: IResource<any, any, any, any>,
  ): (config: any) => Promise<any> {
    const interceptors =
      this.interceptorRegistry.getGlobalResourceInterceptors();

    if (interceptors.length === 0) {
      return runner;
    }

    const reversedInterceptors = [...interceptors].reverse();

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

    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = currentNext;

      currentNext = async (cfg: any) => {
        const executionInput = createExecutionInput(cfg, nextFunction);
        const wrappedNext = (input: IResourceMiddlewareExecutionInput<any>) => {
          return nextFunction(input.resource.config);
        };
        return interceptor(wrappedNext, executionInput);
      };
    }

    return currentNext;
  }

  /**
   * Wraps a middleware runner with its specific interceptors in onion style
   */
  private wrapWithInterceptors(
    middlewareRunner: (config: any) => Promise<any>,
    interceptors: Array<(next: any, input: any) => Promise<any>>,
  ): (config: any) => Promise<any> {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }

    const reversedInterceptors = [...interceptors].reverse();
    let wrapped = middlewareRunner;

    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = wrapped;

      wrapped = async (config: any) => {
        const executionInput: IResourceMiddlewareExecutionInput<any> = {
          resource: {
            definition: null as any,
            config: config,
          },
          next: nextFunction as any,
        };

        const wrappedNext = (input: IResourceMiddlewareExecutionInput<any>) => {
          return nextFunction(input.resource.config);
        };

        return interceptor(wrappedNext as any, executionInput);
      };
    }

    return wrapped;
  }
}
