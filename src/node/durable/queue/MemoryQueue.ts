import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../core/interfaces/queue";
import { BaseMemoryQueue } from "../../queue/BaseMemoryQueue";

export class MemoryQueue
  extends BaseMemoryQueue<QueueMessage<unknown>>
  implements IDurableQueue
{
  protected override shouldDeliver(message: QueueMessage<unknown>): boolean {
    return message.attempts <= message.maxAttempts;
  }

  protected override shouldRequeue(message: QueueMessage<unknown>): boolean {
    return message.attempts < message.maxAttempts;
  }

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    return this.enqueueMessage(
      message as Omit<QueueMessage<unknown>, "id" | "createdAt" | "attempts">,
    );
  }

  async consume<T>(handler: MessageHandler<T>): Promise<void> {
    this.messageHandler = async (message) =>
      handler(message as QueueMessage<T>);
    this.scheduleProcessing();
  }

  async ack(messageId: string): Promise<void> {
    return this.ackMessage(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    return this.nackMessage(messageId, requeue);
  }
}
