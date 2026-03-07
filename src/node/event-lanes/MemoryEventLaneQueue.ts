import { BaseMemoryQueue } from "../queue/BaseMemoryQueue";
import type {
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "./types";

export class MemoryEventLaneQueue
  extends BaseMemoryQueue<EventLaneMessage>
  implements IEventLaneQueue
{
  private acceptingWork = true;

  async enqueue(
    message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
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
    return this.ackMessage(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    return this.nackMessage(messageId, requeue);
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

  protected override canProcess(): boolean {
    return this.acceptingWork && super.canProcess();
  }
}
