import type { AnyTask } from "../../defs";
import { Match, check } from "../../tools/check";
import type { CronResourceConfig } from "./types";

function isTaskLike(value: unknown): value is AnyTask {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  );
}

const cronOnlyEntryPattern = Match.OneOf(
  String,
  Match.Where((value: unknown) => isTaskLike(value)),
);

const cronResourceConfigPattern = Match.ObjectIncluding({
  only: Match.Optional([cronOnlyEntryPattern]),
});

export function resolveOnlySet(
  only: NonNullable<CronResourceConfig["only"]>,
): Set<string> {
  const ids = new Set<string>();
  for (const entry of only) {
    ids.add(typeof entry === "string" ? entry : entry.id);
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
