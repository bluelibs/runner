import type { ITask, IEvent, IEventEmission } from "../../../defs";

export type TunnelMode = "client" | "server" | "none";

export type TunnelTaskSelector =
  | Array<string | ITask<any, any, any, any, any, any>>
  | ((task: ITask<any, any, any, any, any, any>) => boolean);

export type TunnelEventSelector =
  | Array<string | IEvent<any>>
  | ((event: IEvent<any>) => boolean);

export interface TunnelTagConfig {
  // Whether the tunnel is client-side or server-side. Defualts to "none"
  mode?: TunnelMode;
  // Array of task ids or task definitions, or a filter function
  tasks?: TunnelTaskSelector;
  // Array of event ids or event definitions, or a filter function
  events?: TunnelEventSelector;
}

export type TunnelTaskRunner = (
  task: ITask<any, any, any, any, any, any>,
  input?: any,
) => Promise<any>;

export interface TunnelRunner {
  // Called when a tunneled task runs; receives the task definition
  run?: TunnelTaskRunner;
  // Called when a tunneled event is emitted; receives the event definition
  emit?: (event: IEventEmission<any>) => Promise<any>;
}
