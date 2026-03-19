import { BaseMemoryQueue } from "../queue/BaseMemoryQueue";
import type {
  EventLaneEnqueueMessage,
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "./types";

export class MemoryEventLaneQueue
  extends BaseMemoryQueue<EventLaneMessage>
  implements IEventLaneQueue
{
  private acceptingWork = true;

  async enqueue(message: EventLaneEnqueueMessage): Promise<string> {
    return this.enqueueMessage(message);
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

  protected override canStartProcessing(): boolean {
    return this.acceptingWork && super.canStartProcessing();
  }

  protected override canContinueProcessing(): boolean {
    return this.acceptingWork && super.canContinueProcessing();
  }

  protected override shouldRequeueOnHandlerError(): boolean {
    // Retry ownership lives above the queue via explicit nack(true),
    // so uncaught handler failures are not auto-requeued here.
    return false;
  }
}
