import type { AnyTask, TagDependencyAccessor } from "../../defs";
import { shutdownLockdownError } from "../../errors";
import type { Logger } from "../../models/Logger";
import type { TaskRunner } from "../../models/TaskRunner";
import { runtimeSource } from "../../types/runtimeSource";
import { CronParser } from "./cron-parser";
import { cronExecutionError } from "./cron.errors";
import { cronTag } from "./cron.tag";
import { resolveOnlySet } from "./parseCronResourceConfig";
import {
  CronOnError,
  CronResourceConfig,
  CronScheduledTask,
  CronTagConfig,
} from "./types";

type CronTimer = ReturnType<typeof setTimeout>;

interface CronTaskState {
  task: AnyTask;
  config: CronTagConfig;
  timer?: CronTimer;
  stopped: boolean;
  nextRunAt?: Date;
}

type CronTaskMatch = TagDependencyAccessor<typeof cronTag>["tasks"][number];

export interface CronSchedulerDependencies {
  cronTasks: TagDependencyAccessor<typeof cronTag>["tasks"];
  logger: Logger;
  taskRunner: TaskRunner;
}

function getCronConfig(
  task: AnyTask,
  configFromTagMatch: CronTagConfig | undefined,
): CronTagConfig {
  const config = configFromTagMatch ?? cronTag.extract(task);
  if (!config) {
    return cronExecutionError.throw({
      taskId: task.id,
      expression: "<missing>",
      message:
        "Cron tag is missing configuration. Use globals.tags.cron.with({ expression: ... }).",
    });
  }

  return config;
}

export class CronScheduler {
  private readonly stateByTaskId = new Map<string, CronTaskState>();
  private readonly scopedLogger: Logger;
  private disposed = false;

  constructor(private readonly deps: CronSchedulerDependencies) {
    this.scopedLogger = deps.logger.with({ source: "globals.resources.cron" });
  }

  get schedules(): ReadonlyMap<string, CronScheduledTask> {
    return new Map(
      Array.from(this.stateByTaskId.entries()).map(([taskId, state]) => {
        return [
          taskId,
          {
            taskId,
            expression: state.config.expression,
            timezone: state.config.timezone,
            nextRunAt: state.nextRunAt,
            enabled: state.config.enabled !== false,
            stopped: state.stopped,
          },
        ];
      }),
    );
  }

  async start(config: CronResourceConfig): Promise<void> {
    let scheduledTasks = this.deps.cronTasks;
    const onlySet = config.only ? resolveOnlySet(config.only) : undefined;

    if (onlySet) {
      const matchedIds = new Set<string>();
      scheduledTasks = scheduledTasks.filter((entry) => {
        const matches = onlySet.has(entry.definition.id);
        if (matches) {
          matchedIds.add(entry.definition.id);
        }
        return matches;
      });

      for (const id of onlySet) {
        if (!matchedIds.has(id)) {
          await this.scopedLogger.warn(
            `Cron "only" filter references task "${id}" which is not tagged with globals.tags.cron — ignored.`,
            { data: { taskId: id } },
          );
        }
      }
    }

    for (const entry of scheduledTasks) {
      await this.startScheduledTask(entry);
    }
  }

  async cooldown(): Promise<void> {
    for (const state of this.stateByTaskId.values()) {
      this.stopSchedule(state);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const state of this.stateByTaskId.values()) {
      this.stopSchedule(state);
    }
    this.stateByTaskId.clear();
  }

  private isSilent(config: CronTagConfig): boolean {
    return config.silent === true;
  }

  private stopSchedule(state: CronTaskState): void {
    state.stopped = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
  }

  private scheduleNext(state: CronTaskState, from: Date): void {
    if (this.disposed || state.stopped) {
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    const nextRunAt = CronParser.getNextRun(
      state.config.expression,
      from,
      state.config.timezone,
    );
    state.nextRunAt = nextRunAt;

    const delay = Math.max(0, nextRunAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void this.executeTask(state);
    }, delay);
    timer.unref?.();
    state.timer = timer;
  }

  private async executeTask(state: CronTaskState): Promise<void> {
    if (this.disposed || state.stopped) {
      return;
    }

    if (!this.isSilent(state.config)) {
      await this.scopedLogger.info(
        `Running cron task "${state.task.id}" (${state.config.expression}).`,
        {
          data: {
            taskId: state.task.id,
            expression: state.config.expression,
            timezone: state.config.timezone,
            scheduledAt: state.nextRunAt?.toISOString(),
          },
        },
      );
    }

    try {
      await this.deps.taskRunner.run(state.task, state.config.input, {
        source: runtimeSource.resource("globals.resources.cron"),
      });
    } catch (error) {
      if (shutdownLockdownError.is(error)) {
        this.stopSchedule(state);
        return;
      }

      const normalizedError =
        error instanceof Error
          ? error
          : cronExecutionError.new({
              taskId: state.task.id,
              expression: state.config.expression,
              message: String(error),
            });

      if (!this.isSilent(state.config)) {
        await this.scopedLogger.error(
          `Cron task "${state.task.id}" failed during execution.`,
          {
            error: normalizedError,
            data: {
              taskId: state.task.id,
              expression: state.config.expression,
              onError: state.config.onError || CronOnError.Continue,
            },
          },
        );
      }

      if ((state.config.onError || CronOnError.Continue) === CronOnError.Stop) {
        this.stopSchedule(state);
        return;
      }
    }

    this.scheduleNext(state, new Date());
  }

  private async startScheduledTask(entry: CronTaskMatch): Promise<void> {
    const task = entry.definition;
    const tagConfig = getCronConfig(task, entry.config);

    if (tagConfig.enabled === false) {
      if (!this.isSilent(tagConfig)) {
        await this.scopedLogger.info(
          `Cron task "${task.id}" is disabled and will not be scheduled.`,
          {
            data: {
              taskId: task.id,
              expression: tagConfig.expression,
            },
          },
        );
      }
      return;
    }

    if (!CronParser.isValid(tagConfig.expression, tagConfig.timezone)) {
      return cronExecutionError.throw({
        taskId: task.id,
        expression: tagConfig.expression,
        message: "Invalid cron expression configuration.",
      });
    }

    if (!this.isSilent(tagConfig)) {
      await this.scopedLogger.info(
        `Cron task "${task.id}" started with expression "${tagConfig.expression}".`,
        {
          data: {
            taskId: task.id,
            expression: tagConfig.expression,
            timezone: tagConfig.timezone,
            immediate: !!tagConfig.immediate,
            onError: tagConfig.onError || CronOnError.Continue,
          },
        },
      );
    }

    const state: CronTaskState = {
      task,
      config: tagConfig,
      stopped: false,
    };
    this.stateByTaskId.set(task.id, state);

    if (tagConfig.immediate) {
      void this.executeTask(state);
      return;
    }

    this.scheduleNext(state, new Date());
  }
}
