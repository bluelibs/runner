import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../core/interfaces/queue";

export class MemoryQueue implements IDurableQueue {
  private queue: QueueMessage<unknown>[] = [];
  private handler: MessageHandler<unknown> | null = null;
  private isProcessing = false;
  private readonly inFlight = new Map<string, QueueMessage<unknown>>();

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = Math.random().toString(36).substring(2, 10);
    const fullMessage: QueueMessage<unknown> = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };
    this.queue.push(fullMessage);
    setImmediate(() => void this.processNext());
    return id;
  }

  async consume<T>(handler: MessageHandler<T>): Promise<void> {
    this.handler = async (message) => handler(message as QueueMessage<T>);
    setImmediate(() => void this.processNext());
  }

  async ack(_messageId: string): Promise<void> {
    this.inFlight.delete(_messageId);
    setImmediate(() => void this.processNext());
  }

  async nack(_messageId: string, _requeue: boolean = true): Promise<void> {
    const msg = this.inFlight.get(_messageId);
    this.inFlight.delete(_messageId);

    if (_requeue && msg) {
      if (msg.attempts < msg.maxAttempts) {
        this.queue.push(msg);
      }
    }
    setImmediate(() => void this.processNext());
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || !this.handler || this.queue.length === 0) return;

    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;

        const next: QueueMessage<unknown> = {
          ...msg,
          attempts: msg.attempts + 1,
        };

        if (next.attempts > next.maxAttempts) {
          continue;
        }

        this.inFlight.set(next.id, next);
        await this.handler(next);
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
