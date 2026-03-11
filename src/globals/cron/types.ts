import type { AnyTask } from "../../defs";

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

export interface CronResourceConfig {
  /** When provided, only tasks whose id (or definition) appears in this list will be scheduled. */
  only?: (string | AnyTask)[];
}

export interface CronResourceValue {
  schedules: ReadonlyMap<string, CronScheduledTask>;
}
