import { randomUUID } from "node:crypto";
import {
  eventLaneMessageMalformedError,
  eventLaneQueueNotInitializedError,
} from "../../errors";
import { Logger } from "../../models/Logger";
import {
  RabbitMQTransport,
  type RabbitMQTransportReconnectConfig,
} from "../queue/rabbitmq/RabbitMQTransport";
import {
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "./types";

export interface RabbitMQEventLaneQueueConfig {
  url?: string;
  queueName?: string; // legacy
  queue?: {
    name?: string;
    quorum?: boolean;
    deadLetter?:
      | string
      | {
          queue?: string;
          exchange?: string;
          routingKey?: string;
        };
    messageTtl?: number;
    durable?: boolean;
    assert?: "active" | "passive";
    arguments?: Record<string, unknown>;
  };
  prefetch?: number;
  publishOptions?: Record<string, unknown>;
  publishConfirm?: boolean;
  reconnect?: RabbitMQTransportReconnectConfig;
  logger?: Pick<Logger, "error">;
}

export class RabbitMQEventLaneQueue implements IEventLaneQueue {
  private readonly queueName: string;
  private readonly transport: RabbitMQTransport<EventLaneMessage>;
  private acceptingWork = true;
  private readonly messagesById = new Map<string, EventLaneMessage>();

  constructor(config: RabbitMQEventLaneQueueConfig) {
    this.queueName =
      config.queue?.name ?? config.queueName ?? "runner_event_lanes";
    const logger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      }).with({ source: "event-lanes.rabbitmq.queue" });

    this.transport = new RabbitMQTransport<EventLaneMessage>({
      url: config.url,
      prefetch: config.prefetch,
      queue: {
        name: this.queueName,
        quorum: config.queue?.quorum ?? true,
        deadLetter: config.queue?.deadLetter,
        messageTtl: config.queue?.messageTtl,
        durable: config.queue?.durable,
        assert: config.queue?.assert,
        arguments: config.queue?.arguments,
      },
      publishOptions: config.publishOptions,
      publishConfirm: config.publishConfirm,
      reconnect: config.reconnect,
      logger,
      parseFailureLogMessage:
        "RabbitMQEventLaneQueue failed to parse incoming message; nacking without requeue.",
      handlerFailureLogMessage:
        "RabbitMQEventLaneQueue handler threw; leaving ack/nack to consumer.",
      decode: (content) => this.decode(content),
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => eventLaneQueueNotInitializedError.throw(),
    });
  }

  private decode(content: Buffer): EventLaneMessage | null {
    const parsed = JSON.parse(content.toString()) as Partial<EventLaneMessage>;
    if (!parsed || typeof parsed.id !== "string") {
      return null;
    }

    if (
      typeof parsed.laneId !== "string" ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.payload !== "string"
    ) {
      eventLaneMessageMalformedError.throw({
        reason: `Missing required fields for message "${parsed.id}"`,
      });
    }

    if (
      parsed.source === undefined ||
      typeof parsed.source !== "object" ||
      typeof (parsed.source as { id?: unknown }).id !== "string" ||
      typeof (parsed.source as { kind?: unknown }).kind !== "string"
    ) {
      eventLaneMessageMalformedError.throw({
        reason: `Invalid source for message "${parsed.id}"`,
      });
    }

    const parsedAttempts =
      typeof parsed.attempts === "number" ? parsed.attempts : 0;
    const nextAttempts = parsedAttempts + 1;
    const maxAttempts =
      typeof parsed.maxAttempts === "number" ? parsed.maxAttempts : 1;

    const message = {
      ...parsed,
      source: parsed.source as EventLaneMessage["source"],
      createdAt: parsed.createdAt
        ? new Date(parsed.createdAt as unknown as string)
        : new Date(),
      attempts: nextAttempts,
      maxAttempts,
    } as EventLaneMessage;

    this.messagesById.set(message.id, message);

    return message;
  }

  async init(): Promise<void> {
    await this.transport.init();
  }

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = randomUUID();
    const fullMessage: EventLaneMessage = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };

    await this.transport.publish(Buffer.from(JSON.stringify(fullMessage)));
    return id;
  }

  async consume(handler: EventLaneMessageHandler): Promise<void> {
    this.acceptingWork = true;
    await this.transport.consume(async (message) => {
      if (!this.acceptingWork) {
        await this.nack(message.id, true);
        return;
      }

      await handler(message);
    });
  }

  async cooldown(): Promise<void> {
    this.acceptingWork = false;
    await this.transport.cancelConsumer();
  }

  async ack(messageId: string): Promise<void> {
    this.messagesById.delete(messageId);
    await this.transport.ack(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const message = this.messagesById.get(messageId);

    if (!requeue) {
      this.messagesById.delete(messageId);
      await this.transport.nack(messageId, false);
      return;
    }

    if (message) {
      const messageForRetry: EventLaneMessage = {
        ...message,
        attempts: message.attempts,
      };

      await this.transport.publish(
        Buffer.from(JSON.stringify(messageForRetry)),
      );
      this.messagesById.delete(messageId);
      await this.transport.ack(messageId);
      return;
    }

    await this.transport.nack(messageId, requeue);
  }

  async setPrefetch(count: number): Promise<void> {
    await this.transport.setPrefetch(count);
  }

  async dispose(): Promise<void> {
    this.acceptingWork = false;
    this.messagesById.clear();
    await this.transport.dispose();
  }
}
