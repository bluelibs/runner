import { Logger } from "../../../models/Logger";
import { connectAmqplib } from "../../durable/optionalDeps/amqplib";
import { createConsumeHandler } from "./createConsumeHandler";
import {
  buildQueueArguments,
  Channel,
  ChannelModel,
  ConsumeMessage,
  DEFAULT_RECONNECT,
  RabbitMQTransportConfig,
  RabbitMQTransportReconnectConfig,
  resolveDeadLetterConfig,
} from "./RabbitMQTransport.types";
export type {
  RabbitMQTransportConfig,
  RabbitMQTransportQueueConfig,
  RabbitMQTransportReconnectConfig,
} from "./RabbitMQTransport.types";

export class RabbitMQTransport<TMessage> {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly messageMap = new Map<string, ConsumeMessage>();
  private readonly logger: Pick<Logger, "error">;
  private activeConsumerHandler: ((message: TMessage) => Promise<void>) | null =
    null;
  private reconnectInProgress: Promise<void> | null = null;
  private disposed = false;
  private initialized = false;
  private connectionGeneration = 0;

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

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private getReconnectConfig(): Required<RabbitMQTransportReconnectConfig> {
    const config = this.config.reconnect ?? {};
    return {
      enabled: config.enabled ?? DEFAULT_RECONNECT.enabled,
      maxAttempts: config.maxAttempts ?? DEFAULT_RECONNECT.maxAttempts,
      initialDelayMs: config.initialDelayMs ?? DEFAULT_RECONNECT.initialDelayMs,
      maxDelayMs: config.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs,
    };
  }

  private shouldRecover(): boolean {
    const reconnect = this.getReconnectConfig();
    return reconnect.enabled && this.initialized && !this.disposed;
  }

  private requireChannel(): Channel {
    if (!this.channel) {
      return this.config.throwNotInitialized();
    }
    return this.channel;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async setupConnectionAndChannel(): Promise<void> {
    const previousChannel = this.channel;
    const previousConnection = this.connection;

    this.channel = null;
    this.connection = null;
    this.consumerTag = null;
    this.messageMap.clear();

    if (previousChannel) {
      await previousChannel.close().catch(() => undefined);
    }
    if (previousConnection) {
      await previousConnection.close().catch(() => undefined);
    }

    const connection = (await connectAmqplib(
      this.config.url || "amqp://localhost",
    )) as ChannelModel;

    const shouldUseConfirmChannel = this.config.publishConfirm !== false;
    const canCreateConfirmChannel =
      typeof connection.createConfirmChannel === "function";
    const channel =
      shouldUseConfirmChannel && canCreateConfirmChannel
        ? await connection.createConfirmChannel!()
        : await connection.createChannel();

    this.connection = connection;
    this.channel = channel;
    const generation = ++this.connectionGeneration;
    this.attachDisconnectHandlers(connection, channel, generation);

    const durable = this.config.queue.durable ?? true;
    const assertMode = this.config.queue.assert ?? "active";
    const deadLetter = resolveDeadLetterConfig(this.config.queue.deadLetter);

    if (deadLetter.queueName) {
      if (assertMode === "passive") {
        await channel.checkQueue?.(deadLetter.queueName);
      } else {
        await channel.assertQueue(deadLetter.queueName, {
          durable,
        });
      }
    }

    const argumentsMap = buildQueueArguments(this.config.queue, deadLetter);

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

  private attachDisconnectHandlers(
    connection: ChannelModel,
    channel: Channel,
    generation: number,
  ): void {
    const onDisconnect = (source: string, error?: unknown) => {
      this.handleUnexpectedDisconnect(generation, source, error);
    };

    connection.on?.("close", () => onDisconnect("connection.close"));
    connection.on?.("error", (error) =>
      onDisconnect("connection.error", error),
    );
    channel.on?.("close", () => onDisconnect("channel.close"));
    channel.on?.("error", (error) => onDisconnect("channel.error", error));
  }

  private handleUnexpectedDisconnect(
    generation: number,
    source: string,
    error?: unknown,
  ): void {
    if (this.disposed || generation !== this.connectionGeneration) {
      return;
    }

    this.reportError("RabbitMQ transport connection dropped.", {
      source,
      error: this.normalizeError(error),
    });

    this.channel = null;
    this.connection = null;
    this.consumerTag = null;
    this.messageMap.clear();

    if (this.activeConsumerHandler) {
      void this.ensureRecoveredAndResumed(`disconnect:${source}`);
    }
  }

  private async setupWithRetry(reason: string): Promise<void> {
    const reconnect = this.getReconnectConfig();
    const maxAttempts = reconnect.enabled ? reconnect.maxAttempts : 1;
    let delayMs = reconnect.initialDelayMs;
    let attempt = 0;

    while (true) {
      try {
        await this.setupConnectionAndChannel();
        return;
      } catch (error) {
        attempt += 1;
        const normalizedError = this.normalizeError(error);

        if (attempt >= maxAttempts || this.disposed) {
          throw normalizedError;
        }

        this.reportError(
          "RabbitMQ transport connection attempt failed; retrying.",
          {
            reason,
            attempt,
            maxAttempts,
            delayMs,
            error: normalizedError,
          },
        );
        await this.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, reconnect.maxDelayMs);
      }
    }
  }

  private async ensureRecoveredAndResumed(reason: string): Promise<void> {
    if (!this.shouldRecover()) {
      this.config.throwNotInitialized();
    }

    if (this.reconnectInProgress) {
      await this.reconnectInProgress;
      return;
    }

    this.reconnectInProgress = (async () => {
      await this.setupWithRetry(reason);
      const consumeHandler = this.activeConsumerHandler;
      if (consumeHandler) {
        await this.startConsume(consumeHandler);
      }
    })();

    try {
      await this.reconnectInProgress;
    } finally {
      this.reconnectInProgress = null;
    }
  }

  private async withRecovery<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!this.shouldRecover()) {
        throw error;
      }

      this.reportError(
        `RabbitMQ transport operation "${operation}" failed; attempting recovery.`,
        { error: this.normalizeError(error) },
      );
      await this.ensureRecoveredAndResumed(`operation:${operation}`);
      return await action();
    }
  }

  async init(): Promise<void> {
    this.disposed = false;
    await this.setupWithRetry("init");
    this.initialized = true;
  }

  async publish(
    content: Buffer,
    options: Record<string, unknown> = this.config.publishOptions ?? {
      persistent: true,
    },
  ): Promise<void> {
    await this.withRecovery("publish", async () => {
      const channel = this.requireChannel();
      channel.sendToQueue(this.config.queue.name, content, options);
      if (
        this.config.publishConfirm !== false &&
        typeof channel.waitForConfirms === "function"
      ) {
        await channel.waitForConfirms();
      }
    });
  }

  async setPrefetch(count: number): Promise<void> {
    await this.withRecovery("setPrefetch", async () => {
      const channel = this.requireChannel();
      await channel.prefetch(count);
    });
  }

  private settleWithNack(
    channel: Pick<Channel, "nack">,
    msg: ConsumeMessage,
    requeue: boolean,
  ): void {
    try {
      channel.nack(msg, false, requeue);
    } catch (error) {
      this.reportError("RabbitMQ transport failed to nack message.", {
        error: this.normalizeError(error),
        requeue,
      });
    }
  }

  private async startConsume(
    handler: (message: TMessage) => Promise<void>,
  ): Promise<void> {
    const channel = this.requireChannel();
    const onMessage = createConsumeHandler({
      channel,
      decode: this.config.decode,
      resolveMessageId: this.config.resolveMessageId,
      parseFailureLogMessage: this.config.parseFailureLogMessage,
      handlerFailureLogMessage: this.config.handlerFailureLogMessage,
      reportError: (message, data) => this.reportError(message, data),
      normalizeError: (error) => this.normalizeError(error),
      settleWithNack: (targetChannel, msg, requeue) =>
        this.settleWithNack(targetChannel, msg, requeue),
      messageMap: this.messageMap,
      handler,
    });

    const consumeReply = (await channel.consume(
      this.config.queue.name,
      onMessage,
    )) as { consumerTag?: unknown };

    if (typeof consumeReply?.consumerTag === "string") {
      this.consumerTag = consumeReply.consumerTag;
      return;
    }

    this.consumerTag = null;
  }

  async consume(handler: (message: TMessage) => Promise<void>): Promise<void> {
    this.activeConsumerHandler = handler;
    await this.withRecovery("consume", async () => {
      await this.startConsume(handler);
    });
  }

  async cancelConsumer(): Promise<void> {
    this.activeConsumerHandler = null;

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
    this.disposed = true;
    this.initialized = false;
    this.connectionGeneration += 1;
    this.reconnectInProgress = null;

    await this.cancelConsumer();
    this.messageMap.clear();

    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;

    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    this.consumerTag = null;
  }
}
