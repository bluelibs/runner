import type { ITask } from "../../../defs";

export type TunnelTaskSelector =
  | Array<string | ITask<any, any, any, any, any, any>>
  | ((task: ITask<any, any, any, any, any, any>) => boolean);

export interface TunnelTagConfig {
  // Array of task ids or task definitions, or a filter function
  tasks: TunnelTaskSelector;
}

export interface TunnelRunner {
  run: (taskId: string, input?: any) => Promise<any>;
}

