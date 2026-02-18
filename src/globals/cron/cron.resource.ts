import { defineResource } from "../../define";
import type { AnyTask, DependencyMapType } from "../../defs";
import { loggerResource } from "../resources/logger.resource";
import { storeResource } from "../resources/store.resource";
import { taskRunnerResource } from "../resources/taskRunner.resource";
import { globalTags } from "../globalTags";
import { CronParser } from "./cron-parser";
import { cronExecutionError } from "./cron.errors";
import { cronTag } from "./cron.tag";
import {
  CronOnError,
  CronResourceValue,
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

type CronResourceDependencies = DependencyMapType & {
  store: typeof storeResource;
  logger: typeof loggerResource;
  taskRunner: typeof taskRunnerResource;
};

export const cronResource = defineResource<
  void,
  Promise<CronResourceValue>,
  CronResourceDependencies
>({
  id: "globals.resources.cron",
  dependencies: {
    store: storeResource,
    logger: loggerResource,
    taskRunner: taskRunnerResource,
  },
  context: () => ({
    disposed: false,
    stateByTaskId: new Map<string, CronTaskState>(),
  }),
  init: async (_config, { store, logger, taskRunner }, context) => {
    const scopedLogger = logger.with({ source: "globals.resources.cron" });
    const scheduledTasks = store.getTasksWithTag(cronTag);

    const isSilent = (config: CronTagConfig): boolean => config.silent === true;

    const scheduleNext = (taskState: CronTaskState, from: Date): void => {
      if (context.disposed || taskState.stopped) {
        return;
      }

      if (taskState.timer) {
        clearTimeout(taskState.timer);
        taskState.timer = undefined;
      }

      const nextRunAt = CronParser.getNextRun(
        taskState.config.expression,
        from,
        taskState.config.timezone,
      );
      taskState.nextRunAt = nextRunAt;

      const delay = Math.max(0, nextRunAt.getTime() - Date.now());
      const timer = setTimeout(() => {
        void executeTask(taskState);
      }, delay);
      timer.unref?.();
      taskState.timer = timer;
    };

    const executeTask = async (taskState: CronTaskState): Promise<void> => {
      if (context.disposed || taskState.stopped) {
        return;
      }

      if (!isSilent(taskState.config)) {
        await scopedLogger.info(
          `Running cron task "${taskState.task.id}" (${taskState.config.expression}).`,
          {
            data: {
              taskId: taskState.task.id,
              expression: taskState.config.expression,
              timezone: taskState.config.timezone,
              scheduledAt: taskState.nextRunAt?.toISOString(),
            },
          },
        );
      }

      try {
        await taskRunner.run(taskState.task, taskState.config.input);
      } catch (error) {
        const normalizedError =
          error instanceof Error
            ? error
            : cronExecutionError.new({
                taskId: taskState.task.id,
                expression: taskState.config.expression,
                message: String(error),
              });

        if (!isSilent(taskState.config)) {
          await scopedLogger.error(
            `Cron task "${taskState.task.id}" failed during execution.`,
            {
              error: normalizedError,
              data: {
                taskId: taskState.task.id,
                expression: taskState.config.expression,
                onError: taskState.config.onError || CronOnError.Continue,
              },
            },
          );
        }

        if (
          (taskState.config.onError || CronOnError.Continue) ===
          CronOnError.Stop
        ) {
          taskState.stopped = true;
          if (taskState.timer) {
            clearTimeout(taskState.timer);
            taskState.timer = undefined;
          }
          return;
        }
      }

      scheduleNext(taskState, new Date());
    };

    for (const task of scheduledTasks) {
      const config = getCronConfig(task);
      if (config.enabled === false) {
        if (!isSilent(config)) {
          await scopedLogger.info(
            `Cron task "${task.id}" is disabled and will not be scheduled.`,
            {
              data: {
                taskId: task.id,
                expression: config.expression,
              },
            },
          );
        }
        continue;
      }

      if (!CronParser.isValid(config.expression, config.timezone)) {
        return cronExecutionError.throw({
          taskId: task.id,
          expression: config.expression,
          message: "Invalid cron expression configuration.",
        });
      }

      if (!isSilent(config)) {
        await scopedLogger.info(
          `Cron task "${task.id}" started with expression "${config.expression}".`,
          {
            data: {
              taskId: task.id,
              expression: config.expression,
              timezone: config.timezone,
              immediate: !!config.immediate,
              onError: config.onError || CronOnError.Continue,
            },
          },
        );
      }

      const taskState: CronTaskState = {
        task,
        config,
        stopped: false,
      };
      context.stateByTaskId.set(task.id, taskState);

      if (config.immediate) {
        void executeTask(taskState);
      } else {
        scheduleNext(taskState, new Date());
      }
    }

    const toPublicState = (
      map: Map<string, CronTaskState>,
    ): ReadonlyMap<string, CronScheduledTask> => {
      return new Map(
        Array.from(map.entries()).map(([taskId, state]) => {
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
    };

    return {
      get schedules() {
        return toPublicState(context.stateByTaskId);
      },
    };
  },
  dispose: async (_value, _config, _deps, context) => {
    context.disposed = true;

    for (const state of context.stateByTaskId.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      state.timer = undefined;
      state.stopped = true;
    }

    context.stateByTaskId.clear();
  },
  tags: [globalTags.system],
  meta: {
    title: "Cron Scheduler",
    description:
      "Discovers tasks tagged with globals.tags.cron and schedules them with resilient timer-based execution.",
  },
});

function getCronConfig(task: AnyTask): CronTagConfig {
  const config = cronTag.extract(task);
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
