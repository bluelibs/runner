import { Logger } from "../../../models/Logger";
import { normalizeError } from "../../../tools/normalizeError";
import {
  openRabbitMQChannel,
  resolveReconnect,
  setupRabbitMQWithRetry,
} from "./connectRabbitMQ";
import { createTransportConsumer } from "./createTransportConsumer";
import { RabbitMQDeliveryTracker } from "./RabbitMQDeliveryTracker";
import { RabbitMQPublisher } from "./RabbitMQPublisher";
import {
  Channel,
  ChannelModel,
  RabbitMQTransportConfig,
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
  private readonly deliveries = new RabbitMQDeliveryTracker<TMessage>();
  private readonly logger: Pick<Logger, "error">;
  private activeConsumerHandler: ((message: TMessage) => Promise<void>) | null =
    null;
  private reconnectInProgress: Promise<void> | null = null;
  private disposed = false;
  private initialized = false;
  private connectionGeneration = 0;
  private readonly publisher = new RabbitMQPublisher();

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

  private shouldRecover(): boolean {
    const reconnect = resolveReconnect(this.config.reconnect);
    return reconnect.enabled && this.initialized && !this.disposed;
  }

  private requireChannel(): Channel {
    if (!this.channel) {
      return this.config.throwNotInitialized();
    }
    return this.channel;
  }

  private async setupConnectionAndChannel(): Promise<void> {
    // Retired channels can emit close synchronously while recovery closes them.
    const generation = ++this.connectionGeneration;
    this.publisher.reset();
    const previousChannel = this.channel;
    const previousConnection = this.connection;

    this.channel = null;
    this.connection = null;
    this.consumerTag = null;
    this.deliveries.clear();

    if (previousChannel) {
      await previousChannel.close().catch(() => undefined);
    }
    if (previousConnection) {
      await previousConnection.close().catch(() => undefined);
    }

    await openRabbitMQChannel(this.config, (connection, channel) => {
      this.connection = connection;
      this.channel = channel;
      this.attachDisconnectHandlers(connection, channel, generation);
    });
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
      error: normalizeError(error),
    });

    this.channel = null;
    this.publisher.close();
    this.connection = null;
    this.consumerTag = null;
    this.deliveries.clear();

    if (this.activeConsumerHandler) {
      void this.ensureRecoveredAndResumed(`disconnect:${source}`);
    }
  }

  private async setupWithRetry(reason: string): Promise<void> {
    await setupRabbitMQWithRetry({
      reason,
      reconnect: resolveReconnect(this.config.reconnect),
      setup: () => this.setupConnectionAndChannel(),
      disposed: () => this.disposed,
      report: (message, data) => this.reportError(message, data),
    });
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
        { error: normalizeError(error) },
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
      await this.publisher.publish(
        this.requireChannel(),
        this.config.queue.name,
        content,
        options,
        this.config.publishConfirm !== false,
      );
    });
  }

  async setPrefetch(count: number): Promise<void> {
    await this.withRecovery("setPrefetch", async () => {
      const channel = this.requireChannel();
      await channel.prefetch(count);
    });
  }

  private async startConsume(
    handler: (message: TMessage) => Promise<void>,
  ): Promise<void> {
    const channel = this.requireChannel();
    const onMessage = createTransportConsumer({
      channel,
      config: this.config,
      deliveries: this.deliveries,
      handler,
      reportError: (message, data) => this.reportError(message, data),
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

  /** Pins settlement ownership while an adapter awaits a retry publication. */
  readonly withDelivery = this.deliveries.withDelivery.bind(this.deliveries);
  /** Resolves the payload belonging to the consumer's current broker delivery. */
  getDeliveryMessage(messageId: string): TMessage | undefined {
    return this.deliveries.getMessage(messageId);
  }

  async ack(messageId: string): Promise<void> {
    this.deliveries.ack(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    this.deliveries.nack(messageId, requeue);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.publisher.close();
    this.initialized = false;
    this.connectionGeneration += 1;
    this.reconnectInProgress = null;

    await this.cancelConsumer();
    this.deliveries.clear();

    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;

    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    this.consumerTag = null;
  }
}
