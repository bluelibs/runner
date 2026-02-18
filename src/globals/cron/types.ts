export enum CronOnError {
  Continue = "continue",
  Stop = "stop",
}

export interface CronTagConfig {
  expression: string;
  input?: unknown;
  timezone?: string;
  immediate?: boolean;
  enabled?: boolean;
  onError?: CronOnError;
}

export interface CronScheduledTask {
  taskId: string;
  expression: string;
  timezone?: string;
  nextRunAt?: Date;
  enabled: boolean;
  stopped: boolean;
}

export interface CronResourceValue {
  schedules: ReadonlyMap<string, CronScheduledTask>;
}
