import { defineResource } from "../../definers/defineResource";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import type { DependencyMapType } from "../../defs";
import { loggerResource } from "../resources/logger.resource";
import { storeResource } from "../resources/store.resource";
import { taskRunnerResource } from "../resources/taskRunner.resource";
import { globalTags } from "../globalTags";
import { cronTag } from "./cron.tag";
import { CronResourceConfig, CronResourceValue } from "./types";
import { CronScheduler } from "./CronScheduler";
import { parseCronResourceConfig } from "./parseCronResourceConfig";

type CronResourceDependencies = DependencyMapType & {
  cron: typeof cronTag;
  logger: typeof loggerResource;
  store: typeof storeResource;
  taskRunner: typeof taskRunnerResource;
};

export const cronResource = defineResource<
  CronResourceConfig,
  Promise<CronResourceValue>,
  CronResourceDependencies
>(
  markFrameworkDefinition({
    id: "runner.cron",
    dependencies: {
      cron: cronTag,
      logger: loggerResource,
      store: storeResource,
      taskRunner: taskRunnerResource,
    },
    configSchema: {
      parse: parseCronResourceConfig,
    },
    context: () => ({
      scheduler: undefined as CronScheduler | undefined,
    }),
    init: async (config, { cron, logger, store, taskRunner }, context) => {
      const scheduler = new CronScheduler({
        cronTasks: cron.tasks,
        logger,
        resolveDefinitionId: (entry) => store.resolveDefinitionId(entry),
        taskRunner,
      });
      context.scheduler = scheduler;
      await scheduler.start(config);

      return {
        get schedules() {
          return scheduler.schedules;
        },
      };
    },
    cooldown: async (_value, _config, _deps, context) => {
      if (!context.scheduler) {
        return;
      }
      await context.scheduler.cooldown();
    },
    dispose: async (_value, _config, _deps, context) => {
      if (!context.scheduler) {
        return;
      }
      await context.scheduler.dispose();
      context.scheduler = undefined;
    },
    tags: [globalTags.system],
    meta: {
      title: "Cron Scheduler",
      description:
        "Discovers tasks tagged with runner.tags.cron and schedules them with resilient timer-based execution.",
    },
  }),
);
