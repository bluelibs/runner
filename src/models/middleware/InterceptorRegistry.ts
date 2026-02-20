import { lockedError } from "../../errors";
import {
  TaskMiddlewareInterceptor,
  ResourceMiddlewareInterceptor,
} from "./types";

type InterceptorRecord<TInterceptor> = {
  interceptor: TInterceptor;
  ownerResourceId?: string;
};

export type InterceptorOwnerSnapshot = {
  globalTaskInterceptorOwnerIds: readonly string[];
  globalResourceInterceptorOwnerIds: readonly string[];
  perTaskMiddlewareInterceptorOwnerIds: Readonly<
    Record<string, readonly string[]>
  >;
  perResourceMiddlewareInterceptorOwnerIds: Readonly<
    Record<string, readonly string[]>
  >;
};

/**
 * Centralized registry for all interceptor types.
 * Manages storage and retrieval of global and per-middleware interceptors.
 */
export class InterceptorRegistry {
  private taskInterceptors: InterceptorRecord<TaskMiddlewareInterceptor>[] = [];
  private resourceInterceptors: InterceptorRecord<ResourceMiddlewareInterceptor>[] =
    [];
  private perTaskMiddleware: Map<
    string,
    InterceptorRecord<TaskMiddlewareInterceptor>[]
  > = new Map();
  private perResourceMiddleware: Map<
    string,
    InterceptorRecord<ResourceMiddlewareInterceptor>[]
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
  addGlobalTaskInterceptor(
    interceptor: TaskMiddlewareInterceptor,
    ownerResourceId?: string,
  ): void {
    this.checkLock();
    this.taskInterceptors.push({ interceptor, ownerResourceId });
  }

  /**
   * Adds a global resource interceptor
   */
  addGlobalResourceInterceptor(
    interceptor: ResourceMiddlewareInterceptor,
    ownerResourceId?: string,
  ): void {
    this.checkLock();
    this.resourceInterceptors.push({ interceptor, ownerResourceId });
  }

  /**
   * Adds an interceptor for a specific task middleware instance
   */
  addTaskMiddlewareInterceptor(
    middlewareId: string,
    interceptor: TaskMiddlewareInterceptor,
    ownerResourceId?: string,
  ): void {
    this.checkLock();
    if (!this.perTaskMiddleware.has(middlewareId)) {
      this.perTaskMiddleware.set(middlewareId, []);
    }
    this.perTaskMiddleware
      .get(middlewareId)!
      .push({ interceptor, ownerResourceId });
  }

  /**
   * Adds an interceptor for a specific resource middleware instance
   */
  addResourceMiddlewareInterceptor(
    middlewareId: string,
    interceptor: ResourceMiddlewareInterceptor,
    ownerResourceId?: string,
  ): void {
    this.checkLock();
    if (!this.perResourceMiddleware.has(middlewareId)) {
      this.perResourceMiddleware.set(middlewareId, []);
    }
    this.perResourceMiddleware
      .get(middlewareId)!
      .push({ interceptor, ownerResourceId });
  }

  /**
   * Gets all global task interceptors
   */
  getGlobalTaskInterceptors(): readonly TaskMiddlewareInterceptor[] {
    return Object.freeze(
      this.taskInterceptors.map((record) => record.interceptor),
    );
  }

  /**
   * Gets all global resource interceptors
   */
  getGlobalResourceInterceptors(): readonly ResourceMiddlewareInterceptor[] {
    return Object.freeze(
      this.resourceInterceptors.map((record) => record.interceptor),
    );
  }

  /**
   * Gets interceptors for a specific task middleware
   */
  getTaskMiddlewareInterceptors(
    middlewareId: string,
  ): readonly TaskMiddlewareInterceptor[] {
    const interceptors = this.perTaskMiddleware.get(middlewareId) ?? [];
    return Object.freeze(interceptors.map((record) => record.interceptor));
  }

  /**
   * Gets interceptors for a specific resource middleware
   */
  getResourceMiddlewareInterceptors(
    middlewareId: string,
  ): readonly ResourceMiddlewareInterceptor[] {
    const interceptors = this.perResourceMiddleware.get(middlewareId) ?? [];
    return Object.freeze(interceptors.map((record) => record.interceptor));
  }

  getOwnerSnapshot(): InterceptorOwnerSnapshot {
    return Object.freeze({
      globalTaskInterceptorOwnerIds: this.extractOwnerIds(
        this.taskInterceptors,
      ),
      globalResourceInterceptorOwnerIds: this.extractOwnerIds(
        this.resourceInterceptors,
      ),
      perTaskMiddlewareInterceptorOwnerIds: this.extractOwnerIdsMap(
        this.perTaskMiddleware,
      ),
      perResourceMiddlewareInterceptorOwnerIds: this.extractOwnerIdsMap(
        this.perResourceMiddleware,
      ),
    });
  }

  private extractOwnerIds<TInterceptor>(
    records: readonly InterceptorRecord<TInterceptor>[],
  ): readonly string[] {
    const uniqueOwnerIds = new Set<string>();
    for (const record of records) {
      if (!record.ownerResourceId) {
        continue;
      }
      uniqueOwnerIds.add(record.ownerResourceId);
    }
    return Object.freeze(Array.from(uniqueOwnerIds));
  }

  private extractOwnerIdsMap<TInterceptor>(
    map: ReadonlyMap<string, readonly InterceptorRecord<TInterceptor>[]>,
  ): Readonly<Record<string, readonly string[]>> {
    const ownerIdsByMiddlewareId: Record<string, readonly string[]> = {};

    for (const [middlewareId, records] of map.entries()) {
      const ownerIds = this.extractOwnerIds(records);
      if (ownerIds.length === 0) {
        continue;
      }
      ownerIdsByMiddlewareId[middlewareId] = ownerIds;
    }

    return Object.freeze(ownerIdsByMiddlewareId);
  }
}
