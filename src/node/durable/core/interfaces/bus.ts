export interface BusEvent {
  type: string;
  payload: unknown;
  timestamp: Date;
}

export type BusEventHandler = (event: BusEvent) => Promise<void>;

export interface IEventBus {
  publish(channel: string, event: BusEvent): Promise<void>;
  subscribe(channel: string, handler: BusEventHandler): Promise<void>;
  unsubscribe(channel: string, handler?: BusEventHandler): Promise<void>;

  init?(): Promise<void>;
  dispose?(): Promise<void>;
}
