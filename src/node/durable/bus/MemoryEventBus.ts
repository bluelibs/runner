import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";
import { Logger } from "../../../models/Logger";

export interface MemoryEventBusConfig {
  logger?: Logger;
  onHandlerError?: (error: unknown) => void | Promise<void>;
}

export class MemoryEventBus implements IEventBus {
  private handlers = new Map<string, Set<BusEventHandler>>();
  private readonly logger: Logger;
  private readonly onHandlerError?: (error: unknown) => void | Promise<void>;

  constructor(config: MemoryEventBusConfig = {}) {
    const baseLogger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.bus.memory" });
    this.onHandlerError = config.onHandlerError;
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

      await this.logger.error("MemoryEventBus handler failed.", {
        error,
        data: { channel },
      });
    } catch (callbackError) {
      try {
        await this.logger.error("MemoryEventBus error callback failed.", {
          error: callbackError,
          data: { channel, originalError: error },
        });
      } catch {
        // Logging must remain best-effort in event bus loops.
      }
    }
  }

  async publish(channel: string, event: BusEvent): Promise<void> {
    const subs = this.handlers.get(channel);
    if (!subs) return;
    for (const handler of subs) {
      try {
        await handler(event);
      } catch (error) {
        await this.reportHandlerError(error, channel);
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

  async unsubscribe(channel: string, handler?: BusEventHandler): Promise<void> {
    if (!handler) {
      this.handlers.delete(channel);
      return;
    }

    const subs = this.handlers.get(channel);
    if (!subs) return;
    subs.delete(handler);
    if (subs.size === 0) {
      this.handlers.delete(channel);
    }
  }
}
