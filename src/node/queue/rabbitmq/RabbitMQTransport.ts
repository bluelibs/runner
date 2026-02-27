import { Logger } from "../../../models/Logger";
import { connectAmqplib } from "../../durable/optionalDeps/amqplib";

type ConsumeMessage = { content: Buffer };

type Channel = {
  assertQueue: (
    queue: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  checkQueue?: (queue: string) => Promise<unknown>;
  prefetch: (count: number) => Promise<unknown>;
  sendToQueue: (
    queue: string,
    content: Buffer,
    options: Record<string, unknown>,
  ) => unknown;
  consume: (
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => Promise<void>,
  ) => Promise<unknown>;
  cancel: (consumerTag: string) => Promise<unknown>;
  ack: (msg: ConsumeMessage) => unknown;
  nack: (msg: ConsumeMessage, allUpTo?: boolean, requeue?: boolean) => unknown;
  close: () => Promise<unknown>;
};

type ChannelModel = {
  createChannel: () => Promise<Channel>;
  close: () => Promise<unknown>;
};

export interface RabbitMQTransportQueueConfig {
  name: string;
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
}

export interface RabbitMQTransportConfig<TMessage> {
  url?: string;
  queue: RabbitMQTransportQueueConfig;
  prefetch?: number;
  publishOptions?: Record<string, unknown>;
  logger?: Pick<Logger, "error">;
  parseFailureLogMessage: string;
  handlerFailureLogMessage: string;
  decode: (content: Buffer) => TMessage | null;
  resolveMessageId: (message: TMessage) => string | undefined;
  throwNotInitialized: () => never;
}

export class RabbitMQTransport<TMessage> {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly messageMap = new Map<string, ConsumeMessage>();
  private readonly logger: Pick<Logger, "error">;

  constructor(private readonly config: RabbitMQTransportConfig<TMessage>) {
    this.logger =
      config.logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      }).with({ source: "node.rabbitmq.transport" });
  }

  private reportError(message: string, data: Record<string, unknown>) {
    try {
      void this.logger.error(message, data);
    } catch {
      // Ignore logger failures to preserve queue processing flow.
    }
  }

  private requireChannel(): Channel {
    if (!this.channel) {
      return this.config.throwNotInitialized();
    }
    return this.channel;
  }

  private resolveDeadLetterConfig(): {
    queueName?: string;
    exchange?: string;
    routingKey?: string;
  } {
    const deadLetter = this.config.queue.deadLetter;
    if (!deadLetter) {
      return {};
    }

    if (typeof deadLetter === "string") {
      return {
        queueName: deadLetter,
        exchange: "",
        routingKey: deadLetter,
      };
    }

    const queueName = deadLetter.queue;
    if (deadLetter.exchange !== undefined) {
      return {
        queueName,
        exchange: deadLetter.exchange,
        routingKey: deadLetter.routingKey,
      };
    }

    if (!queueName) {
      return {
        exchange: undefined,
        routingKey: deadLetter.routingKey,
      };
    }

    return {
      queueName,
      exchange: "",
      routingKey: deadLetter.routingKey ?? queueName,
    };
  }

  async init(): Promise<void> {
    const connection = (await connectAmqplib(
      this.config.url || "amqp://localhost",
    )) as ChannelModel;
    const channel = await connection.createChannel();
    this.connection = connection;
    this.channel = channel;

    const durable = this.config.queue.durable ?? true;
    const assertMode = this.config.queue.assert ?? "active";
    const deadLetter = this.resolveDeadLetterConfig();

    if (deadLetter.queueName) {
      if (assertMode === "passive") {
        await channel.checkQueue?.(deadLetter.queueName);
      } else {
        await channel.assertQueue(deadLetter.queueName, {
          durable,
        });
      }
    }

    const argumentsMap: Record<string, unknown> = {
      ...(this.config.queue.arguments ?? {}),
    };
    if (
      (this.config.queue.quorum ?? true) &&
      argumentsMap["x-queue-type"] === undefined
    ) {
      argumentsMap["x-queue-type"] = "quorum";
    }
    if (deadLetter.exchange !== undefined) {
      argumentsMap["x-dead-letter-exchange"] = deadLetter.exchange;
    }
    if (deadLetter.routingKey !== undefined) {
      argumentsMap["x-dead-letter-routing-key"] = deadLetter.routingKey;
    }
    if (this.config.queue.messageTtl !== undefined) {
      argumentsMap["x-message-ttl"] = this.config.queue.messageTtl;
    }

    if (assertMode === "passive") {
      await channel.checkQueue?.(this.config.queue.name);
    } else {
      await channel.assertQueue(this.config.queue.name, {
        durable,
        arguments: argumentsMap,
      });
    }
    await channel.prefetch(this.config.prefetch || 10);
  }

  async publish(
    content: Buffer,
    options: Record<string, unknown> = this.config.publishOptions ?? {
      persistent: true,
    },
  ): Promise<void> {
    const channel = this.requireChannel();
    channel.sendToQueue(this.config.queue.name, content, options);
  }

  async setPrefetch(count: number): Promise<void> {
    const channel = this.requireChannel();
    await channel.prefetch(count);
  }

  async consume(handler: (message: TMessage) => Promise<void>): Promise<void> {
    const channel = this.requireChannel();

    const consumeReply = (await channel.consume(
      this.config.queue.name,
      async (msg) => {
        if (!msg) {
          return;
        }

        let decoded: TMessage | null;
        try {
          decoded = this.config.decode(msg.content);
        } catch (error) {
          this.reportError(this.config.parseFailureLogMessage, {
            error: error instanceof Error ? error : new Error(String(error)),
            payload: msg.content.toString(),
          });
          channel.nack(msg, false, false);
          return;
        }

        if (!decoded) {
          channel.nack(msg, false, false);
          return;
        }

        const messageId = this.config.resolveMessageId(decoded);
        if (!messageId) {
          channel.nack(msg, false, false);
          return;
        }

        this.messageMap.set(messageId, msg);
        try {
          await handler(decoded);
        } catch (error) {
          this.reportError(this.config.handlerFailureLogMessage, {
            error: error instanceof Error ? error : new Error(String(error)),
            messageId,
          });
          try {
            channel.nack(msg, false, false);
          } finally {
            this.messageMap.delete(messageId);
          }
        }
      },
    )) as { consumerTag?: unknown };

    if (typeof consumeReply?.consumerTag === "string") {
      this.consumerTag = consumeReply.consumerTag;
      return;
    }

    this.consumerTag = null;
  }

  async cancelConsumer(): Promise<void> {
    const channel = this.channel;
    const consumerTag = this.consumerTag;
    if (!channel || !consumerTag) {
      return;
    }

    await channel.cancel(consumerTag);
    this.consumerTag = null;
  }

  async ack(messageId: string): Promise<void> {
    const channel = this.channel;
    const msg = this.messageMap.get(messageId);
    if (!channel || !msg) {
      return;
    }

    channel.ack(msg);
    this.messageMap.delete(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const channel = this.channel;
    const msg = this.messageMap.get(messageId);
    if (!channel || !msg) {
      return;
    }

    channel.nack(msg, false, requeue);
    this.messageMap.delete(messageId);
  }

  async dispose(): Promise<void> {
    await this.cancelConsumer();
    this.messageMap.clear();
    await this.channel?.close();
    await this.connection?.close();
    this.consumerTag = null;
  }
}
