import Redis from "ioredis";
import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";
import { Serializer } from "../../../serializer";

export interface RedisEventBusConfig {
  prefix?: string;
  redis?: Redis | string;
}

export class RedisEventBus implements IEventBus {
  private pub: Redis;
  private sub: Redis;
  private prefix: string;
  private readonly handlers = new Map<string, Set<BusEventHandler>>();
  private readonly serializer = new Serializer();

  constructor(config: RedisEventBusConfig) {
    this.pub =
      typeof config.redis === "string"
        ? new Redis(config.redis)
        : config.redis || new Redis();
    this.sub = this.pub.duplicate();
    this.prefix = config.prefix || "durable:bus:";

    this.sub.on("message", (chan, message) => {
      const handlers = this.handlers.get(chan);
      if (!handlers || handlers.size === 0) return;

      const event = this.deserializeEvent(message);
      if (!event) return;

      handlers.forEach((h) => h(event).catch(console.error));
    });
  }

  private k(channel: string): string {
    return `${this.prefix}${channel}`;
  }

  private tryParse<T>(fn: () => T): T | null {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  private coerceTimestamp(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  private toBusEvent(value: unknown): BusEvent | null {
    if (!value || typeof value !== "object") return null;

    const record = value as Record<string, unknown>;
    if (typeof record.type !== "string") return null;

    const timestamp = this.coerceTimestamp(record.timestamp);
    if (!timestamp) return null;

    return {
      type: record.type,
      payload: record.payload,
      timestamp,
    };
  }

  private deserializeEvent(message: string): BusEvent | null {
    const parsed = this.tryParse(() =>
      this.serializer.deserialize<unknown>(message),
    );
    const event = this.toBusEvent(parsed);
    if (event) return event;

    const legacyParsed = this.tryParse(() => JSON.parse(message) as unknown);
    return this.toBusEvent(legacyParsed);
  }

  async publish(channel: string, event: BusEvent): Promise<void> {
    await this.pub.publish(this.k(channel), this.serializer.stringify(event));
  }

  async subscribe(channel: string, handler: BusEventHandler): Promise<void> {
    const fullChannel = this.k(channel);
    let subs = this.handlers.get(fullChannel);
    if (!subs) {
      subs = new Set();
      this.handlers.set(fullChannel, subs);
      await this.sub.subscribe(fullChannel);
    }

    subs.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    const fullChannel = this.k(channel);
    await this.sub.unsubscribe(fullChannel);
    this.handlers.delete(fullChannel);
  }

  async dispose(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
