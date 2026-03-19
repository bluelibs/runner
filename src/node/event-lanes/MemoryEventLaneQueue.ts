import { randomUUID } from "node:crypto";
import type {
  EventLaneEnqueueMessage,
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "./types";

export class MemoryEventLaneQueue implements IEventLaneQueue {
  private queue: EventLaneMessage[] = [];
  private messageHandler: EventLaneMessageHandler | null = null;
  private readonly inFlight = new Map<string, EventLaneMessage>();
  private acceptingWork = true;
  private isProcessing = false;

  async enqueue(message: EventLaneEnqueueMessage): Promise<string> {
    const id = randomUUID();
    this.queue.push({
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    });
    this.scheduleProcessing();
    return id;
  }

  async consume(handler: EventLaneMessageHandler): Promise<void> {
    this.messageHandler = handler;
    this.acceptingWork = true;
    this.scheduleProcessing();
  }

  async cooldown(): Promise<void> {
    this.acceptingWork = false;
  }

  async ack(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
    this.scheduleProcessing();
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const message = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (message && requeue) {
      this.queue.push(message);
    }
    this.scheduleProcessing();
  }

  async setPrefetch(_count: number): Promise<void> {
    // In-memory queue processes sequentially and does not support broker prefetch.
  }

  async dispose(): Promise<void> {
    this.messageHandler = null;
    this.acceptingWork = false;
    this.queue = [];
    this.inFlight.clear();
  }

  private scheduleProcessing(): void {
    setImmediate(() => void this.processNext());
  }

  private async processNext(): Promise<void> {
    if (!this.canStartProcessing()) {
      return;
    }

    this.isProcessing = true;
    try {
      while (this.canContinueProcessing()) {
        const raw = this.queue.shift()!;
        const message = {
          ...raw,
          attempts: raw.attempts + 1,
        };

        this.inFlight.set(message.id, message);
        try {
          await this.messageHandler!(message);
        } catch {
          this.inFlight.delete(message.id);
          // Retry ownership lives above the queue via explicit nack(true),
          // so uncaught handler failures are not auto-requeued here.
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private canStartProcessing(): boolean {
    return (
      this.acceptingWork &&
      !this.isProcessing &&
      this.messageHandler !== null &&
      this.queue.length > 0
    );
  }

  private canContinueProcessing(): boolean {
    return (
      this.acceptingWork &&
      this.messageHandler !== null &&
      this.queue.length > 0
    );
  }
}
