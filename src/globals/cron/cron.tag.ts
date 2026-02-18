import { defineTag } from "../../define";
import { cronConfigurationError } from "./cron.errors";
import { CronOnError, CronTagConfig } from "./types";

const cronOnErrorValues = new Set(Object.values(CronOnError));

export const cronTag = defineTag<CronTagConfig>({
  id: "globals.tags.cron",
  configSchema: {
    parse: (rawValue): CronTagConfig => {
      if (!rawValue || typeof rawValue !== "object") {
        return cronConfigurationError.throw({
          message: "Cron tag config must be an object.",
        });
      }

      const value = rawValue as Partial<CronTagConfig>;

      if (typeof value.expression !== "string" || !value.expression.trim()) {
        return cronConfigurationError.throw({
          message: 'Cron tag config requires a non-empty "expression".',
        });
      }

      if (
        value.timezone !== undefined &&
        (typeof value.timezone !== "string" || !value.timezone.trim())
      ) {
        return cronConfigurationError.throw({
          message:
            'Cron tag config \"timezone\" must be a non-empty string when provided.',
        });
      }

      if (
        value.immediate !== undefined &&
        typeof value.immediate !== "boolean"
      ) {
        return cronConfigurationError.throw({
          message: 'Cron tag config \"immediate\" must be a boolean.',
        });
      }

      if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
        return cronConfigurationError.throw({
          message: 'Cron tag config \"enabled\" must be a boolean.',
        });
      }

      if (
        value.onError !== undefined &&
        !cronOnErrorValues.has(value.onError)
      ) {
        return cronConfigurationError.throw({
          message:
            'Cron tag config \"onError\" must be either \"continue\" or \"stop\".',
        });
      }

      return {
        expression: value.expression,
        input: value.input,
        timezone: value.timezone,
        immediate: value.immediate,
        enabled: value.enabled,
        onError: value.onError,
      };
    },
  },
  meta: {
    title: "Cron",
    description:
      "Marks tasks that should be scheduled by globals.resources.cron using a cron expression.",
  },
});
