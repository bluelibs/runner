import { randomUUID } from "node:crypto";

/**
 * Minimum message shape every in-memory queue message must satisfy.
 * Individual queue types extend this with domain-specific fields.
 */
export interface BaseQueueMessage {
  id: string;
  createdAt: Date;
  attempts: number;
}

/**
 * Shared in-memory queue infrastructure: enqueue ↔ ack/nack ↔ sequential
 * processing loop with overridable delivery/requeue policy. Both EventLane and
 * Durable queues delegate their core machinery here, adding only their
 * domain-specific behaviour (cooldown, prefetch, dispose, generics, etc.).
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
    if (msg && requeue && this.shouldRequeue(msg)) {
      this.requeueMessage(msg);
    }
    this.scheduleProcessing();
  }

  /** Override to add extra preconditions before a processing loop starts. */
  protected canStartProcessing(): boolean {
    return !this.isProcessing && this.canContinueProcessing();
  }

  /** Override to stop an active loop (for example after cooldown). */
  protected canContinueProcessing(): boolean {
    return !!this.messageHandler && this.queue.length > 0;
  }

  protected toDeliveredMessage(message: TMsg): TMsg {
    return {
      ...message,
      attempts: message.attempts + 1,
    } as TMsg;
  }

  protected shouldDeliver(_message: TMsg): boolean {
    return true;
  }

  protected shouldRequeue(_message: TMsg): boolean {
    return true;
  }

  protected shouldRequeueOnHandlerError(message: TMsg): boolean {
    return this.shouldRequeue(message);
  }

  protected requeueMessage(message: TMsg): void {
    this.queue.push(message);
  }

  protected scheduleProcessing(): void {
    setImmediate(() => void this.processNext());
  }

  protected async processNext(): Promise<void> {
    if (!this.canStartProcessing()) return;

    this.isProcessing = true;
    try {
      while (this.canContinueProcessing()) {
        const msg = this.queue.shift()!;
        const next = this.toDeliveredMessage(msg);
        if (!this.shouldDeliver(next)) {
          continue;
        }

        this.inFlight.set(next.id, next);
        try {
          await this.messageHandler!(next);
        } catch {
          // Fail-safe: if consumer throws before ack/nack, the queue may opt
          // into requeueing instead of dropping the in-flight message.
          this.inFlight.delete(next.id);
          if (this.shouldRequeueOnHandlerError(next)) {
            this.requeueMessage(next);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
