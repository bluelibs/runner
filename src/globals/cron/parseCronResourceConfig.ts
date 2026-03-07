import type { AnyTask } from "../../defs";
import { validationError } from "../../errors";
import { Match, check } from "../../tools/check";
import type { CronResourceConfig } from "./types";

function isTaskLike(value: unknown): value is AnyTask {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string" &&
    (value as { id: string }).id.trim().length > 0
  );
}

const cronOnlyEntryPattern = Match.OneOf(
  Match.NonEmptyString,
  Match.Where((value: unknown) => isTaskLike(value)),
);

const cronResourceConfigPattern = Match.ObjectIncluding({
  only: Match.Optional([cronOnlyEntryPattern]),
});

export function resolveOnlySet(
  only: NonNullable<CronResourceConfig["only"]>,
  resolveId?: (entry: string | AnyTask) => string | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (let index = 0; index < only.length; index += 1) {
    const entry = only[index];
    const fallback = typeof entry === "string" ? entry : entry.id;
    const resolvedByResolver = resolveId?.(entry);
    if (
      resolvedByResolver === undefined &&
      resolveId &&
      typeof entry !== "string"
    ) {
      validationError.throw({
        subject: "Cron resource config",
        id: "runner.cron",
        originalError: `cron.with({ only }) entry at index ${index} could not be resolved to a canonical id.`,
      });
    }

    const resolved = resolvedByResolver ?? fallback;
    if (typeof resolved !== "string" || resolved.trim().length === 0) {
      validationError.throw({
        subject: "Cron resource config",
        id: "runner.cron",
        originalError: `cron.with({ only }) entry at index ${index} resolved to an empty id.`,
      });
    }

    ids.add(resolved);
  }
  return ids;
}

export function parseCronResourceConfig(rawValue: unknown): CronResourceConfig {
  if (rawValue === undefined) {
    return {};
  }

  const { only } = check(rawValue, cronResourceConfigPattern);
  return { only };
}
