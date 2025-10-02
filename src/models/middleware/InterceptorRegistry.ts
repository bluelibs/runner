import { lockedError } from "../../errors";
import {
  TaskMiddlewareInterceptor,
  ResourceMiddlewareInterceptor,
} from "./types";

/**
 * Centralized registry for all interceptor types.
 * Manages storage and retrieval of global and per-middleware interceptors.
 */
export class InterceptorRegistry {
  private taskInterceptors: TaskMiddlewareInterceptor[] = [];
  private resourceInterceptors: ResourceMiddlewareInterceptor[] = [];
  private perTaskMiddleware: Map<string, TaskMiddlewareInterceptor[]> =
    new Map();
  private perResourceMiddleware: Map<
    string,
    ResourceMiddlewareInterceptor[]
  > = new Map();

  #isLocked = false;

  /**
   * Gets the current lock status
   */
  get isLocked(): boolean {
    return this.#isLocked;
  }

  /**
   * Locks the registry, preventing any further modifications
   */
  lock(): void {
    this.#isLocked = true;
  }

  /**
   * Throws an error if the registry is locked
   */
  private checkLock(): void {
    if (this.#isLocked) {
      lockedError.throw({ what: "MiddlewareManager" });
    }
  }

  /**
   * Adds a global task interceptor
   */
  addGlobalTaskInterceptor(interceptor: TaskMiddlewareInterceptor): void {
    this.checkLock();
    this.taskInterceptors.push(interceptor);
  }

  /**
   * Adds a global resource interceptor
   */
  addGlobalResourceInterceptor(
    interceptor: ResourceMiddlewareInterceptor,
  ): void {
    this.checkLock();
    this.resourceInterceptors.push(interceptor);
  }

  /**
   * Adds an interceptor for a specific task middleware instance
   */
  addTaskMiddlewareInterceptor(
    middlewareId: string,
    interceptor: TaskMiddlewareInterceptor,
  ): void {
    this.checkLock();
    if (!this.perTaskMiddleware.has(middlewareId)) {
      this.perTaskMiddleware.set(middlewareId, []);
    }
    this.perTaskMiddleware.get(middlewareId)!.push(interceptor);
  }

  /**
   * Adds an interceptor for a specific resource middleware instance
   */
  addResourceMiddlewareInterceptor(
    middlewareId: string,
    interceptor: ResourceMiddlewareInterceptor,
  ): void {
    this.checkLock();
    if (!this.perResourceMiddleware.has(middlewareId)) {
      this.perResourceMiddleware.set(middlewareId, []);
    }
    this.perResourceMiddleware.get(middlewareId)!.push(interceptor);
  }

  /**
   * Gets all global task interceptors
   */
  getGlobalTaskInterceptors(): TaskMiddlewareInterceptor[] {
    return this.taskInterceptors;
  }

  /**
   * Gets all global resource interceptors
   */
  getGlobalResourceInterceptors(): ResourceMiddlewareInterceptor[] {
    return this.resourceInterceptors;
  }

  /**
   * Gets interceptors for a specific task middleware
   */
  getTaskMiddlewareInterceptors(
    middlewareId: string,
  ): TaskMiddlewareInterceptor[] {
    return this.perTaskMiddleware.get(middlewareId) || [];
  }

  /**
   * Gets interceptors for a specific resource middleware
   */
  getResourceMiddlewareInterceptors(
    middlewareId: string,
  ): ResourceMiddlewareInterceptor[] {
    return this.perResourceMiddleware.get(middlewareId) || [];
  }
}
