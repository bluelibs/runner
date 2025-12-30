import { IEvent } from "../../defs";
import { globalTags } from "../../globals/globalTags";
import { HandlerOptionsDefaults, IListenerStorage } from "./types";

type IsExcludedFromGlobal = (event: IEvent<any>) => boolean;

/**
 * Manages event-specific and global listener collections plus caching.
 * Keeps ordering invariant using binary insertion.
 */
export class ListenerRegistry {
  readonly listeners: Map<string, IListenerStorage[]> = new Map();
  readonly globalListeners: IListenerStorage[] = [];

  readonly cachedMergedListeners: Map<string, IListenerStorage[]> = new Map();
  private _globalListenersCacheValid = true;

  private readonly isExcludedFromGlobal: IsExcludedFromGlobal;

  constructor(isExcludedFromGlobal?: IsExcludedFromGlobal) {
    this.isExcludedFromGlobal =
      isExcludedFromGlobal ??
      ((event) => globalTags.excludeFromGlobalHooks.exists(event));
  }

  get globalListenersCacheValid() {
    return this._globalListenersCacheValid;
  }

  addListener(eventId: string, newListener: IListenerStorage): void {
    const listeners = this.listeners.get(eventId);
    if (listeners) {
      this.insertListener(listeners, newListener);
    } else {
      this.listeners.set(eventId, [newListener]);
    }
    this.invalidateCache(eventId);
  }

  addGlobalListener(newListener: IListenerStorage): void {
    this.insertListener(this.globalListeners, newListener);
    this.invalidateCache();
  }

  getListenersForEmit(eventDefinition: IEvent<any>): IListenerStorage[] {
    const excludeGlobal = this.isExcludedFromGlobal(eventDefinition);
    if (excludeGlobal) {
      return this.listeners.get(eventDefinition.id) || [];
    }
    return this.getCachedMergedListeners(eventDefinition.id);
  }

  hasListeners(eventDefinition: IEvent<any>): boolean {
    const eventListeners = this.listeners.get(eventDefinition.id) || [];

    if (eventListeners.length > 0) {
      return true;
    }

    if (this.globalListeners.length === 0) {
      return false;
    }

    return !this.isExcludedFromGlobal(eventDefinition);
  }

  /**
   * Cached merge between event-specific and global listeners.
   * Exposed for backward compatibility with existing tests.
   */
  getCachedMergedListeners(eventId: string): IListenerStorage[] {
    if (!this._globalListenersCacheValid) {
      this.cachedMergedListeners.clear();
      this._globalListenersCacheValid = true;
    }

    let cached = this.cachedMergedListeners.get(eventId);
    if (!cached) {
      const eventListeners = this.listeners.get(eventId) || [];
      if (eventListeners.length === 0 && this.globalListeners.length === 0) {
        cached = [];
      } else if (eventListeners.length === 0) {
        cached = this.globalListeners;
      } else if (this.globalListeners.length === 0) {
        cached = eventListeners;
      } else {
        cached = this.mergeSortedListeners(
          eventListeners,
          this.globalListeners,
        );
      }
      this.cachedMergedListeners.set(eventId, cached);
    }
    return cached;
  }

  private invalidateCache(eventId?: string): void {
    if (eventId) {
      this.cachedMergedListeners.delete(eventId);
    } else {
      this._globalListenersCacheValid = false;
    }
  }

  private mergeSortedListeners(
    a: IListenerStorage[],
    b: IListenerStorage[],
  ): IListenerStorage[] {
    const result: IListenerStorage[] = [];
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
      if (a[i].order <= b[j].order) {
        result.push(a[i++]);
      } else {
        result.push(b[j++]);
      }
    }

    while (i < a.length) result.push(a[i++]);
    while (j < b.length) result.push(b[j++]);

    return result;
  }

  private insertListener(
    listeners: IListenerStorage[],
    newListener: IListenerStorage,
  ): void {
    let low = 0;
    let high = listeners.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (listeners[mid].order < newListener.order) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    listeners.splice(low, 0, newListener);
  }
}

export function createListener(
  newListener: Partial<IListenerStorage>,
): IListenerStorage {
  return {
    handler: newListener.handler!,
    order: newListener.order ?? HandlerOptionsDefaults.order,
    filter: newListener.filter,
    id: newListener.id,
    isGlobal: newListener.isGlobal ?? false,
  };
}
