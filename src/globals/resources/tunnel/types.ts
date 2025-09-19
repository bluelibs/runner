import type { ITask, IEvent, IEventEmission } from "../../../defs";

export type TunnelMode = "client" | "server" | "both" | "none";

export type TunnelTaskSelector =
  | Array<string | ITask<any, any, any, any, any, any>>
  | ((task: ITask<any, any, any, any, any, any>) => boolean);

export type TunnelEventSelector =
  | Array<string | IEvent<any>>
  | ((event: IEvent<any>) => boolean);

export type EventDeliveryMode =
  | "mirror"
  | "remote-only"
  | "local-only"
  | "remote-first";

export interface TunnelTagConfig {}

export type TunnelTaskRunner = (
  task: ITask<any, any, any, any, any, any>,
  input?: any,
) => Promise<any>;

export interface TunnelRunner {
  transport?: "http" | string;
  mode?: TunnelMode;
  tasks?: TunnelTaskSelector;
  events?: TunnelEventSelector;
  eventDeliveryMode?: EventDeliveryMode;
  // Called when a tunneled task runs; receives the task definition
  run?: TunnelTaskRunner;
  // Called when a tunneled event is emitted; receives the event definition
  emit?: (event: IEventEmission<any>) => Promise<any>;
}
