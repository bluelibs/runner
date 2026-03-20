/**
 * Durable queue message delivered to worker consumers.
 */
export interface QueueMessage<T = unknown> {
  id: string;
  type: "execute" | "resume" | "schedule";
  payload: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

/**
 * Queue consumer callback used by durable workers.
 */
export type MessageHandler<T = unknown> = (
  message: QueueMessage<T>,
) => Promise<void>;

/**
 * Transport contract used to distribute durable workflow execution work.
 */
export interface IDurableQueue {
  /**
   * Enqueues a durable worker message for asynchronous delivery.
   */
  enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string>;

  /**
   * Starts consuming queue messages with the provided handler.
   */
  consume<T>(handler: MessageHandler<T>): Promise<void>;

  /**
   * Acknowledges a successfully handled message.
   */
  ack(messageId: string): Promise<void>;

  /**
   * Rejects a message, optionally requesting requeue.
   */
  nack(messageId: string, requeue?: boolean): Promise<void>;

  /**
   * Stops the active consumer without disposing the whole queue transport.
   * Durable workers use this during runtime teardown so queue deliveries do not
   * outlive the service/store lifecycle.
   */
  cancelConsumer?(): Promise<void>;

  init?(): Promise<void>;
  dispose?(): Promise<void>;
}
