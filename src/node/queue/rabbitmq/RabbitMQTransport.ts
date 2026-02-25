import { Logger } from "../../../models/Logger";
import { connectAmqplib } from "../../durable/optionalDeps/amqplib";

type ConsumeMessage = { content: Buffer };

type Channel = {
  assertQueue: (
    queue: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
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
  deadLetter?: string;
  messageTtl?: number;
}

export interface RabbitMQTransportConfig<TMessage> {
  url?: string;
  queue: RabbitMQTransportQueueConfig;
  prefetch?: number;
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

  async init(): Promise<void> {
    const connection = (await connectAmqplib(
      this.config.url || "amqp://localhost",
    )) as ChannelModel;
    const channel = await connection.createChannel();
    this.connection = connection;
    this.channel = channel;

    const deadLetterQueue = this.config.queue.deadLetter;
    if (deadLetterQueue) {
      await channel.assertQueue(deadLetterQueue, {
        durable: true,
      });
    }

    const argumentsMap: Record<string, unknown> = {};
    if (this.config.queue.quorum ?? true) {
      argumentsMap["x-queue-type"] = "quorum";
    }
    if (deadLetterQueue) {
      argumentsMap["x-dead-letter-exchange"] = "";
      argumentsMap["x-dead-letter-routing-key"] = deadLetterQueue;
    }
    if (this.config.queue.messageTtl !== undefined) {
      argumentsMap["x-message-ttl"] = this.config.queue.messageTtl;
    }

    await channel.assertQueue(this.config.queue.name, {
      durable: true,
      arguments: argumentsMap,
    });
    await channel.prefetch(this.config.prefetch || 10);
  }

  async publish(
    content: Buffer,
    options: Record<string, unknown> = { persistent: true },
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

    await channel.consume(this.config.queue.name, async (msg) => {
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
      }
    });
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
    await this.channel?.close();
    await this.connection?.close();
  }
}
