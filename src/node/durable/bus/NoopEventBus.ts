import type {
  BusEvent,
  BusEventHandler,
  IEventBus,
} from "../core/interfaces/bus";

export class NoopEventBus implements IEventBus {
  async publish(_channel: string, _event: BusEvent): Promise<void> {}
  async subscribe(_channel: string, _handler: BusEventHandler): Promise<void> {}
  async unsubscribe(_channel: string): Promise<void> {}
}
