import { EventHandlerType, IEvent, IEventDefinition } from "./defs";

const HandlerOptionsDefaults = { order: 0 };

interface IListenerStorage {
  order: number;
  filter?: (event: IEvent<any>) => boolean;
  handler: EventHandlerType;
}

export interface IEventHandlerOptions<T = any> {
  order?: number;
  filter?: (event: IEvent<T>) => boolean;
}

export class EventManager {
  private listeners: Map<string, IListenerStorage[]> = new Map();
  private globalListeners: IListenerStorage[] = [];

  async emit<TInput>(
    eventDefinition: IEventDefinition<TInput>,
    ...args: TInput extends void ? [] : [TInput]
  ): Promise<void> {
    const data = args[0];
    const eventListeners = this.listeners.get(eventDefinition.id) || [];
    const allListeners = this.sortListeners([
      ...eventListeners,
      ...this.globalListeners,
    ]);

    const event: IEvent = {
      id: eventDefinition.id,
      data,
    };

    for (const listener of allListeners) {
      const ok = !listener.filter || listener.filter(event);
      if (ok) {
        await listener.handler(event);
      }
    }
  }

  addListener<T>(
    event: IEventDefinition | Array<IEventDefinition>,
    handler: EventHandlerType<T>,
    options: IEventHandlerOptions<T> = HandlerOptionsDefaults
  ): void {
    if (Array.isArray(event)) {
      event.forEach((id) => this.addListener(id, handler, options));
    } else {
      const eventId = event.id;
      const listeners = this.listeners.get(eventId) || [];
      const newListener: IListenerStorage = {
        handler,
        order: options.order || 0,
        filter: options.filter,
      };

      const newListeners = this.sortListeners([...listeners, newListener]);
      this.listeners.set(eventId, newListeners);
    }
  }

  addGlobalListener(
    handler: EventHandlerType,
    options: IEventHandlerOptions = HandlerOptionsDefaults
  ): void {
    const newListener: IListenerStorage = {
      handler,
      order: options.order || 0,
      filter: options.filter,
    };

    this.globalListeners = this.sortListeners([
      ...this.globalListeners,
      newListener,
    ]);
  }

  private sortListeners(listeners: IListenerStorage[]): IListenerStorage[] {
    return [...listeners].sort((a, b) => a.order - b.order);
  }
}
