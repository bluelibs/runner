import {
  EventHandlerType,
  IEvent,
  IEventDefinition,
  IEventEmission,
} from "../defs";
import { LockedError, ValidationError } from "../errors";
import { globalTags } from "../globals/globalTags";
import { Logger } from "./Logger";

const HandlerOptionsDefaults = { order: 0 };

interface IListenerStorage {
  order: number;
  filter?: (event: IEventEmission<any>) => boolean;
  handler: EventHandlerType;
  /** True when this listener originates from addGlobalListener(). */
  isGlobal: boolean;
}

export interface IEventHandlerOptions<T = any> {
  order?: number;
  filter?: (event: IEventEmission<T>) => boolean;
  /**
   * Represents the listener ID. Use this to avoid a listener calling himself.
   */
  id?: string;
}

export class EventManager {
  private listeners: Map<string, IListenerStorage[]> = new Map();
  private globalListeners: IListenerStorage[] = [];
  private cachedMergedListeners: Map<string, IListenerStorage[]> = new Map();
  private globalListenersCacheValid = true;
  #isLocked = false;

  get isLocked() {
    return this.#isLocked;
  }

  lock() {
    this.#isLocked = true;
  }

  checkLock() {
    if (this.#isLocked) {
      throw new LockedError("EventManager");
    }
  }

  private mergeSortedListeners(
    a: IListenerStorage[],
    b: IListenerStorage[],
  ): IListenerStorage[] {
    const result: IListenerStorage[] = [];
    let i = 0,
      j = 0;
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

  /**
   * Returns true if the given emission carries the tag that marks
   * it as excluded from global ("*") listeners.
   */
  private isExcludedFromGlobal(event: IEventEmission<any>): boolean {
    return globalTags.excludeFromGlobalHooks.exists(event);
  }

  private getCachedMergedListeners(eventId: string): IListenerStorage[] {
    if (!this.globalListenersCacheValid) {
      this.cachedMergedListeners.clear();
      this.globalListenersCacheValid = true;
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
      this.globalListenersCacheValid = false;
    }
  }

  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string,
  ): Promise<void> {
    // Validate payload with schema if provided
    if (eventDefinition.payloadSchema) {
      try {
        data = eventDefinition.payloadSchema.parse(data);
      } catch (error) {
        throw new ValidationError(
          "Event payload",
          eventDefinition.id,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    const allListeners = this.getCachedMergedListeners(eventDefinition.id);

    if (allListeners.length === 0) {
      return;
    }

    let propagationStopped = false;

    const event: IEventEmission = {
      id: eventDefinition.id,
      data,
      timestamp: new Date(),
      source,
      meta: eventDefinition.meta || {},
      stopPropagation: () => {
        propagationStopped = true;
      },
      isPropagationStopped: () => propagationStopped,
      tags: eventDefinition.tags,
    };

    const excludeFromGlobal = this.isExcludedFromGlobal(event);

    for (const listener of allListeners) {
      if (propagationStopped) {
        break;
      }

      // If this event is marked to be excluded from global listeners,
      // we only allow non-global (event-specific) listeners to run.
      // Global listeners are mixed into `allListeners` but flagged.
      if (excludeFromGlobal && listener.isGlobal) {
        continue;
      }

      if (!listener.filter || listener.filter(event)) {
        await listener.handler(event);
      }
    }
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

  addListener<T>(
    event: IEvent<T> | Array<IEvent<T>>,
    handler: EventHandlerType<T>,
    options: IEventHandlerOptions<T> = HandlerOptionsDefaults,
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
      isGlobal: false,
    };

    if (Array.isArray(event)) {
      event.forEach((id) => this.addListener(id, handler, options));
    } else {
      const eventId = event.id;
      const listeners = this.listeners.get(eventId);
      if (listeners) {
        this.insertListener(listeners, newListener);
      } else {
        this.listeners.set(eventId, [newListener]);
      }
      this.invalidateCache(eventId);
    }
  }

  addGlobalListener(
    handler: EventHandlerType,
    options: IEventHandlerOptions = HandlerOptionsDefaults,
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
      isGlobal: true,
    };
    this.insertListener(this.globalListeners, newListener);
    this.invalidateCache();
  }

  hasListeners<T>(eventDefinition: IEvent<T>): boolean {
    const eventListeners = this.listeners.get(eventDefinition.id);

    if (!eventListeners) {
      return false;
    }

    return eventListeners.length > 0 || this.globalListeners.length > 0;
  }
}
