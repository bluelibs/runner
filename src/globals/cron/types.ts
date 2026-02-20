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
  /** When true, suppresses all cron log output for this task. Defaults to false. */
  silent?: boolean;
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
