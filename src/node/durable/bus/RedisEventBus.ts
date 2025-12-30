import Redis from "ioredis";
import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";

export interface RedisEventBusConfig {
  prefix?: string;
  redis?: Redis | string;
}

export class RedisEventBus implements IEventBus {
  private pub: Redis;
  private sub: Redis;
  private prefix: string;
  private handlers = new Map<string, Set<BusEventHandler>>();

  constructor(config: RedisEventBusConfig) {
    this.pub =
      typeof config.redis === "string"
        ? new Redis(config.redis)
        : config.redis || new Redis();
    this.sub = this.pub.duplicate();
    this.prefix = config.prefix || "durable:bus:";
  }

  private k(channel: string): string {
    return `${this.prefix}${channel}`;
  }

  async publish(channel: string, event: BusEvent): Promise<void> {
    await this.pub.publish(this.k(channel), JSON.stringify(event));
  }

  async subscribe(channel: string, handler: BusEventHandler): Promise<void> {
    let subs = this.handlers.get(channel);
    if (!subs) {
      subs = new Set();
      this.handlers.set(channel, subs);
      await this.sub.subscribe(this.k(channel));

      this.sub.on("message", (chan, message) => {
        if (chan !== this.k(channel)) return;
        const event = JSON.parse(message);
        const handlers = this.handlers.get(channel);
        if (!handlers) return;
        handlers.forEach((h) => h(event).catch(console.error));
      });
    }

    subs.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.sub.unsubscribe(this.k(channel));
    this.handlers.delete(channel);
  }

  async dispose(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
