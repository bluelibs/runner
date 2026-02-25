import { randomUUID } from "node:crypto";
import {
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "./types";

export class MemoryEventLaneQueue implements IEventLaneQueue {
  private queue: EventLaneMessage[] = [];
  private handler: EventLaneMessageHandler | null = null;
  private isProcessing = false;
  private readonly inFlight = new Map<string, EventLaneMessage>();

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    const id = randomUUID();
    const fullMessage: EventLaneMessage = {
      ...message,
      id,
      createdAt: new Date(),
      attempts: 0,
    };
    this.queue.push(fullMessage);
    setImmediate(() => void this.processNext());
    return id;
  }

  async consume(handler: EventLaneMessageHandler): Promise<void> {
    this.handler = handler;
    setImmediate(() => void this.processNext());
  }

  async ack(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
    setImmediate(() => void this.processNext());
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    const msg = this.inFlight.get(messageId);
    this.inFlight.delete(messageId);
    if (requeue && msg && msg.attempts < msg.maxAttempts) {
      this.queue.push(msg);
    }
    setImmediate(() => void this.processNext());
  }

  async setPrefetch(_count: number): Promise<void> {
    // In-memory queue processes sequentially and does not support broker prefetch.
  }

  async dispose(): Promise<void> {
    this.handler = null;
    this.queue = [];
    this.inFlight.clear();
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || !this.handler || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        const next: EventLaneMessage = {
          ...msg,
          attempts: msg.attempts + 1,
        };

        if (next.attempts > next.maxAttempts) {
          continue;
        }

        this.inFlight.set(next.id, next);
        try {
          await this.handler(next);
        } catch {
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
