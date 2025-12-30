export interface QueueMessage<T = unknown> {
  id: string;
  type: "execute" | "resume" | "schedule";
  payload: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

export type MessageHandler<T = unknown> = (
  message: QueueMessage<T>,
) => Promise<void>;

export interface IDurableQueue {
  enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string>;

  consume<T>(handler: MessageHandler<T>): Promise<void>;

  ack(messageId: string): Promise<void>;

  nack(messageId: string, requeue?: boolean): Promise<void>;

  init?(): Promise<void>;
  dispose?(): Promise<void>;
}
