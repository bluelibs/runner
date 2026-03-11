import { randomUUID } from "node:crypto";

/**
 * Minimum message shape every in-memory queue message must satisfy.
 * Individual queue types extend this with domain-specific fields.
 */
export interface BaseQueueMessage {
  id: string;
  createdAt: Date;
  attempts: number;
  maxAttempts: number;
}

/**
 * Shared in-memory queue infrastructure: enqueue ↔ ack/nack ↔ sequential
 * processing loop with retry policy. Both EventLane and Durable queues
 * delegate their core machinery here, adding only their domain-specific
 * behaviour (cooldown, prefetch, dispose, generics, etc.).
 */
export abstract class BaseMemoryQueue<TMsg extends BaseQueueMessage> {
  protected queue: TMsg[] = [];
  protected messageHandler: ((msg: TMsg) => Promise<void>) | null = null;
  protected isProcessing = false;
  protected readonly inFlight = new Map<string, TMsg>();

  protected async enqueueMessage(
    partial: Omit<TMsg, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = randomUUID();
    const fullMessage = {
      ...partial,
      id,
      createdAt: new Date(),
      attempts: 0,
    } as TMsg;
    this.queue.push(fullMessage);
    this.scheduleProcessing();
    return id;
  }

  protected async ackMessage(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
    this.scheduleProcessing();
  }

  protected async nackMessage(
    messageId: string,
    requeue: boolean,
  ): Promise<void> {
    const msg = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (msg && requeue && msg.attempts < msg.maxAttempts) {
      this.queue.push(msg);
    }
    this.scheduleProcessing();
  }

  /** Override to add extra preconditions (e.g. acceptingWork flag). */
  protected canProcess(): boolean {
    return !this.isProcessing && !!this.messageHandler && this.queue.length > 0;
  }

  protected scheduleProcessing(): void {
    setImmediate(() => void this.processNext());
  }

  protected async processNext(): Promise<void> {
    if (!this.canProcess()) return;

    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        const next = { ...msg, attempts: msg.attempts + 1 } as TMsg;

        if (next.attempts > next.maxAttempts) {
          continue;
        }

        this.inFlight.set(next.id, next);
        try {
          await this.messageHandler!(next);
        } catch {
          // Fail-safe: if consumer throws before ack/nack, requeue and keep processing.
          this.inFlight.delete(next.id);
          if (next.attempts < next.maxAttempts) {
            this.queue.push(next);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
