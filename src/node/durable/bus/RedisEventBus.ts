import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";
import { Serializer } from "../../../serializer";
import { createIORedisClient } from "../optionalDeps/ioredis";
import { durableExecutionInvariantError } from "../../../errors";
import { Logger } from "../../../models/Logger";

export interface RedisEventBusConfig {
  prefix?: string;
  redis?: RedisEventBusClient | string;
  logger?: Logger;
  onHandlerError?: (error: unknown) => void | Promise<void>;
}

export interface RedisEventBusClient {
  publish(channel: string, payload: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", fn: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
  duplicate(): RedisEventBusClient;
}

interface ChannelState {
  handlers: Set<BusEventHandler>;
  subscriptionPromise: Promise<void> | null;
}

export class RedisEventBus implements IEventBus {
  private pub: RedisEventBusClient;
  private sub: RedisEventBusClient;
  private prefix: string;
  private readonly channels = new Map<string, ChannelState>();
  private readonly serializer = new Serializer();
  private readonly logger: Logger;
  private readonly onHandlerError?: (error: unknown) => void | Promise<void>;

  constructor(config: RedisEventBusConfig = {}) {
    this.pub =
      typeof config.redis === "string" || config.redis === undefined
        ? (createIORedisClient(config.redis) as RedisEventBusClient)
        : config.redis;
    const baseLogger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.bus.redis" });
    this.onHandlerError = config.onHandlerError;

    if (!this.pub.duplicate) {
      durableExecutionInvariantError.throw({
        message:
          "RedisEventBus requires a redis client that supports duplicate()",
      });
    }

    this.sub = this.pub.duplicate();
    this.prefix = config.prefix || "durable:bus:";

    this.sub.on("message", (chan, message) => {
      const state = this.channels.get(chan);
      if (!state || state.handlers.size === 0) return;

      const event = this.deserializeEvent(message);
      if (!event) return;

      state.handlers.forEach((h) => {
        void (async () => {
          try {
            await h(event);
          } catch (error) {
            await this.reportHandlerError(error, chan);
          }
        })();
      });
    });
  }

  private async reportHandlerError(
    error: unknown,
    channel: string,
  ): Promise<void> {
    try {
      if (this.onHandlerError) {
        await this.onHandlerError(error);
        return;
      }

      await this.logger.error("RedisEventBus handler failed.", {
        error,
        data: { channel },
      });
    } catch (callbackError) {
      try {
        await this.logger.error("RedisEventBus error callback failed.", {
          error: callbackError,
          data: { channel, originalError: error },
        });
      } catch {
        // Logging must remain best-effort in event bus loops.
      }
    }
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

    let state = this.channels.get(fullChannel);

    if (!state) {
      // First subscriber: create state and initiate Redis subscription
      state = {
        handlers: new Set(),
        subscriptionPromise: null,
      };
      this.channels.set(fullChannel, state);

      const subscriptionPromise = this.sub
        .subscribe(fullChannel)
        .then(() => {
          state!.subscriptionPromise = null;
        })
        .catch((err) => {
          this.channels.delete(fullChannel);
          throw err;
        });

      state.subscriptionPromise = subscriptionPromise as Promise<void>;
    }

    // Wait for pending subscription to complete (applies to all callers)
    if (state.subscriptionPromise) {
      await state.subscriptionPromise;
    }

    // Only add handler after subscription succeeds
    state.handlers.add(handler);
  }

  async unsubscribe(channel: string, handler?: BusEventHandler): Promise<void> {
    const fullChannel = this.k(channel);
    const state = this.channels.get(fullChannel);
    if (!state) return;

    if (handler) {
      state.handlers.delete(handler);
      if (state.handlers.size > 0) {
        return;
      }
    }

    await this.sub.unsubscribe(fullChannel);
    this.channels.delete(fullChannel);
  }

  async dispose(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
