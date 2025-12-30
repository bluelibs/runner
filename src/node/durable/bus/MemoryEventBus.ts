import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";

export class MemoryEventBus implements IEventBus {
  private handlers = new Map<string, Set<BusEventHandler>>();

  async publish(channel: string, event: BusEvent): Promise<void> {
    const subs = this.handlers.get(channel);
    if (!subs) return;
    for (const handler of subs) {
      try {
        await handler(event);
      } catch (error) {
        console.error("Error in MemoryEventBus handler", error);
      }
    }
  }

  async subscribe(channel: string, handler: BusEventHandler): Promise<void> {
    let subs = this.handlers.get(channel);
    if (!subs) {
      subs = new Set();
      this.handlers.set(channel, subs);
    }
    subs.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
  }
}
