import { randomUUID } from "node:crypto";
import { durableQueueNotInitializedError } from "../../../errors";
import { Logger } from "../../../models/Logger";
import { RabbitMQTransport } from "../../queue/rabbitmq/RabbitMQTransport";
import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../core/interfaces/queue";

export interface RabbitMQQueueConfig {
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
  logger?: Pick<Logger, "error">;
}

export class RabbitMQQueue implements IDurableQueue {
  private readonly queueName: string;
  private readonly transport: RabbitMQTransport<QueueMessage<unknown>>;

  constructor(config: RabbitMQQueueConfig) {
    this.queueName =
      config.queue?.name ?? config.queueName ?? "durable_executions";
    const logger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      }).with({ source: "durable.rabbitmq.queue" });

    this.transport = new RabbitMQTransport<QueueMessage<unknown>>({
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
      logger,
      parseFailureLogMessage:
        "RabbitMQQueue failed to parse incoming message; nacking without requeue.",
      handlerFailureLogMessage:
        "RabbitMQQueue handler threw; leaving ack/nack to consumer.",
      decode: (content) => this.decode(content),
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => durableQueueNotInitializedError.throw(),
    });
  }

  private decode(content: Buffer): QueueMessage<unknown> | null {
    const parsed = JSON.parse(content.toString()) as Partial<
      QueueMessage<unknown>
    >;
    if (!parsed || typeof parsed.id !== "string") {
      return null;
    }
    const currentAttempts =
      typeof parsed.attempts === "number" ? parsed.attempts : 0;
    return {
      ...parsed,
      attempts: currentAttempts + 1,
    } as QueueMessage<unknown>;
  }

  async init(): Promise<void> {
    await this.transport.init();
  }

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = randomUUID();
    const fullMessage: QueueMessage<T> = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };

    await this.transport.publish(Buffer.from(JSON.stringify(fullMessage)));
    return id;
  }

  async consume<T>(handler: MessageHandler<T>): Promise<void> {
    await this.transport.consume(async (message) =>
      handler(message as QueueMessage<T>),
    );
  }

  async ack(messageId: string): Promise<void> {
    await this.transport.ack(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    await this.transport.nack(messageId, requeue);
  }

  async dispose(): Promise<void> {
    await this.transport.dispose();
  }
}
