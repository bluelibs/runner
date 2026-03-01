import { defineTag } from "../../define";
import { Match } from "../../tools/check";
import { CronOnError, CronTagConfig } from "./types";

const nonEmptyTrimmedString = Match.Where(
  (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0,
);

const cronTagConfigPattern = Match.ObjectIncluding({
  expression: nonEmptyTrimmedString,
  input: Match.Optional(Match.Any),
  timezone: Match.Optional(nonEmptyTrimmedString),
  immediate: Match.Optional(Boolean),
  enabled: Match.Optional(Boolean),
  onError: Match.Optional(Match.OneOf(CronOnError.Continue, CronOnError.Stop)),
  silent: Match.Optional(Boolean),
});

export const cronTag = defineTag<CronTagConfig>({
  id: "globals.tags.cron",
  configSchema: cronTagConfigPattern,
  meta: {
    title: "Cron",
    description:
      "Marks tasks that should be scheduled by globals.resources.cron using a cron expression.",
  },
});
