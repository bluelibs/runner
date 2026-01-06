import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../core/interfaces/queue";
import { connectAmqplib } from "../optionalDeps/amqplib";

type ConsumeMessage = { content: Buffer };

type Channel = {
  assertQueue: (queue: string, options: Record<string, unknown>) => Promise<unknown>;
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

export interface RabbitMQQueueConfig {
  url?: string;
  queueName?: string; // legacy
  queue?: {
    name?: string;
    quorum?: boolean;
    deadLetter?: string;
    messageTtl?: number;
  };
  prefetch?: number;
}

export class RabbitMQQueue implements IDurableQueue {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private url: string;
  private queueName: string;
  private prefetch: number;
  private readonly isQuorum: boolean;
  private readonly deadLetterQueue?: string;
  private readonly messageTtl?: number;
  private messageMap = new Map<string, ConsumeMessage>();

  constructor(config: RabbitMQQueueConfig) {
    this.url = config.url || "amqp://localhost";
    this.queueName =
      config.queue?.name ?? config.queueName ?? "durable_executions";
    this.prefetch = config.prefetch || 10;
    this.isQuorum = config.queue?.quorum ?? true;
    this.deadLetterQueue = config.queue?.deadLetter;
    this.messageTtl = config.queue?.messageTtl;
  }

  async init(): Promise<void> {
    const connection = (await connectAmqplib(this.url)) as ChannelModel;
    const channel = await connection.createChannel();
    this.connection = connection;
    this.channel = channel;

    if (this.deadLetterQueue) {
      await channel.assertQueue(this.deadLetterQueue, {
        durable: true,
      });
    }

    const argumentsMap: Record<string, unknown> = {};
    if (this.isQuorum) {
      argumentsMap["x-queue-type"] = "quorum";
    }
    if (this.deadLetterQueue) {
      argumentsMap["x-dead-letter-exchange"] = "";
      argumentsMap["x-dead-letter-routing-key"] = this.deadLetterQueue;
    }
    if (this.messageTtl !== undefined) {
      argumentsMap["x-message-ttl"] = this.messageTtl;
    }

    await channel.assertQueue(this.queueName, {
      durable: true,
      arguments: argumentsMap,
    });
    await channel.prefetch(this.prefetch);
  }

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const channel = this.channel;
    if (!channel) throw new Error("Queue not initialized");

    const id = Math.random().toString(36).substring(2, 10);
    const fullMessage: QueueMessage<T> = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };

    channel.sendToQueue(
      this.queueName,
      Buffer.from(JSON.stringify(fullMessage)),
      { persistent: true },
    );

    return id;
  }

  async consume<T>(handler: MessageHandler<T>): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error("Queue not initialized");

    await channel.consume(
      this.queueName,
      async (msg: ConsumeMessage | null) => {
        if (msg === null) return;

        const content = JSON.parse(msg.content.toString()) as QueueMessage<T>;
        this.messageMap.set(content.id, msg);

        try {
          await handler(content);
        } catch {
          // Let the consumer decide ack/nack
        }
      },
    );
  }

  async ack(messageId: string): Promise<void> {
    const msg = this.messageMap.get(messageId);
    const channel = this.channel;
    if (msg && channel) {
      channel.ack(msg);
      this.messageMap.delete(messageId);
    }
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const msg = this.messageMap.get(messageId);
    const channel = this.channel;
    if (msg && channel) {
      channel.nack(msg, false, requeue);
      this.messageMap.delete(messageId);
    }
  }

  async dispose(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
