import { EventHandlerType, IEvent, IEventDefinition } from "../defs";
import { Errors } from "../errors";
import { Logger } from "./Logger";

const HandlerOptionsDefaults = { order: 0 };

interface IListenerStorage {
  order: number;
  filter?: (event: IEvent<any>) => boolean;
  handler: EventHandlerType;
}

export interface IEventHandlerOptions<T = any> {
  order?: number;
  filter?: (event: IEvent<T>) => boolean;
  /**
   * Represents the listener ID. Use this to avoid a listener calling himself.
   */
  id?: string;
}

export class EventManager {
  private listeners: Map<string, IListenerStorage[]> = new Map();
  private globalListeners: IListenerStorage[] = [];
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

  async emit<TInput>(
    eventDefinition: IEventDefinition<TInput>,
    data: TInput,
    source: string
  ): Promise<void> {
    const eventListeners = this.listeners.get(eventDefinition.id) || [];
    const allListeners = this.mergeSortedListeners(
      eventListeners,
      this.globalListeners
    );

    const event: IEvent = {
      id: eventDefinition.id,
      data,
      timestamp: new Date(),
      source,
    };

    for (const listener of allListeners) {
      if (!listener.filter || listener.filter(event)) {
        await listener.handler(event);
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
    event: IEventDefinition | Array<IEventDefinition>,
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
  }

  hasListeners<T>(eventDefinition: IEventDefinition<T>): boolean {
    const eventListeners = this.listeners.get(eventDefinition.id) || [];
    return eventListeners.length > 0 || this.globalListeners.length > 0;
  }
}
