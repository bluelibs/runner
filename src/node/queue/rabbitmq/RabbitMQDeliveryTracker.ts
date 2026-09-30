import { AsyncLocalStorage } from "node:async_hooks";
import { rabbitMQDeliveryAmbiguousError } from "./errors";
import type { Channel, ConsumeMessage } from "./RabbitMQTransport.types";

type Delivery<TMessage> = {
  id: string;
  message: TMessage;
  raw: ConsumeMessage;
  channel: Channel;
  active: boolean;
};

/** Keeps logical message identity separate from the delivery being settled. */
export class RabbitMQDeliveryTracker<TMessage> {
  private readonly scope = new AsyncLocalStorage<Delivery<TMessage>>();
  private readonly pending = new Map<string, Set<Delivery<TMessage>>>();

  async run(
    id: string,
    message: TMessage,
    raw: ConsumeMessage,
    channel: Channel,
    handler: () => Promise<void>,
  ): Promise<void> {
    const delivery = { id, message, raw, channel, active: true };
    const deliveries = this.pending.get(id) ?? new Set<Delivery<TMessage>>();
    deliveries.add(delivery);
    this.pending.set(id, deliveries);
    await this.scope.run(delivery, handler);
  }

  getMessage(id: string): TMessage | undefined {
    const delivery = this.resolve(id);
    return delivery?.active ? delivery.message : undefined;
  }

  /** Pins a unique pending delivery across asynchronous settlement preparation. */
  async withDelivery(id: string, action: () => Promise<void>): Promise<void> {
    const delivery = this.resolve(id);
    if (!delivery?.active) return;
    await this.scope.run(delivery, action);
  }

  ack(id: string): void {
    const delivery = this.resolve(id);
    if (!delivery?.active) return;
    delivery.channel.ack(delivery.raw);
    this.remove(delivery);
  }

  nack(id: string, requeue: boolean): void {
    const delivery = this.resolve(id);
    if (!delivery?.active) return;
    delivery.channel.nack(delivery.raw, false, requeue);
    this.remove(delivery);
  }

  clear(): void {
    for (const deliveries of this.pending.values()) {
      for (const delivery of deliveries) delivery.active = false;
    }
    this.pending.clear();
  }

  private resolve(id: string): Delivery<TMessage> | undefined {
    const current = this.scope.getStore();
    // An old handler must never fall through to a redelivery on a new channel.
    if (current?.id === id) return current;
    const deliveries = this.pending.get(id);
    if (deliveries && deliveries.size > 1) {
      throw rabbitMQDeliveryAmbiguousError.new({ messageId: id });
    }
    return deliveries?.values().next().value;
  }

  private remove(delivery: Delivery<TMessage>): void {
    delivery.active = false;
    const deliveries = this.pending.get(delivery.id)!;
    deliveries.delete(delivery);
    if (deliveries.size === 0) this.pending.delete(delivery.id);
  }
}
