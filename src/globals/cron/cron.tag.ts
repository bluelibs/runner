import { defineTag } from "../../define";
import { Match } from "../../tools/check";
import { CronOnError, CronTagConfig } from "./types";

const cronTagConfigPattern = Match.ObjectIncluding({
  expression: Match.NonEmptyString,
  input: Match.Optional(Match.Any),
  timezone: Match.Optional(Match.NonEmptyString),
  immediate: Match.Optional(Boolean),
  enabled: Match.Optional(Boolean),
  onError: Match.Optional(Match.OneOf(CronOnError.Continue, CronOnError.Stop)),
  silent: Match.Optional(Boolean),
});

export const cronTag = defineTag<CronTagConfig>({
  id: "runner.tags.cron",
  configSchema: cronTagConfigPattern,
  meta: {
    title: "Cron",
    description:
      "Marks tasks that should be scheduled by runner.cron using a cron expression.",
  },
});
