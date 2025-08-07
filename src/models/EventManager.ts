import {
  EventHandlerType,
  IEvent,
  IEventDefinition,
  IEventEmission,
} from "../defs";
import { Errors } from "../errors";
import { Logger } from "./Logger";
import { executeFunction } from "../tools/executeFunction";

const HandlerOptionsDefaults = { order: 0 };

interface IListenerStorage {
  order: number;
  filter?: (event: IEventEmission<any>) => boolean;
  handler: EventHandlerType;
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
  private listeners: Map<string | symbol, IListenerStorage[]> = new Map();
  private globalListeners: IListenerStorage[] = [];
  private cachedMergedListeners: Map<string | symbol, IListenerStorage[]> =
    new Map();
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
      throw Errors.locked("EventManager");
    }
  }

  private mergeSortedListeners(
    a: IListenerStorage[],
    b: IListenerStorage[]
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

  private getCachedMergedListeners(
    eventId: string | symbol
  ): IListenerStorage[] {
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
          this.globalListeners
        );
      }
      this.cachedMergedListeners.set(eventId, cached);
    }
    return cached;
  }

  private invalidateCache(eventId?: string | symbol): void {
    if (eventId) {
      this.cachedMergedListeners.delete(eventId);
    } else {
      this.globalListenersCacheValid = false;
    }
  }

  async emit<TInput>(
    eventDefinition: IEvent<TInput>,
    data: TInput,
    source: string | symbol
  ): Promise<void> {
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
    };

    for (const listener of allListeners) {
      if (propagationStopped) {
        break;
      }
      
      if (!listener.filter || listener.filter(event)) {
        await executeFunction(listener.handler, event);
      }
    }
  }

  private insertListener(
    listeners: IListenerStorage[],
    newListener: IListenerStorage
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
    options: IEventHandlerOptions<T> = HandlerOptionsDefaults
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
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
    options: IEventHandlerOptions = HandlerOptionsDefaults
  ): void {
    this.checkLock();
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
    };
    this.insertListener(this.globalListeners, newListener);
    this.invalidateCache();
  }

  hasListeners<T>(eventDefinition: IEvent<T>): boolean {
    const eventListeners = this.listeners.get(eventDefinition.id) || [];
    return eventListeners.length > 0 || this.globalListeners.length > 0;
  }
}
