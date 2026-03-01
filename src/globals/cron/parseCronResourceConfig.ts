import type { AnyTask } from "../../defs";
import type { CronResourceConfig } from "./types";

function parseCronConfigError(message: string): never {
  throw new Error(message);
}

function isTaskLike(value: unknown): value is Pick<AnyTask, "id"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  );
}

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

  if (
    typeof rawValue !== "object" ||
    rawValue === null ||
    Array.isArray(rawValue)
  ) {
    return parseCronConfigError("Cron resource config must be an object.");
  }

  const { only } = rawValue as Partial<CronResourceConfig>;

  if (only !== undefined) {
    if (!Array.isArray(only)) {
      return parseCronConfigError(
        'Cron resource config "only" must be an array of task ids or task definitions.',
      );
    }

    for (const entry of only) {
      if (typeof entry === "string" || isTaskLike(entry)) {
        continue;
      }

      return parseCronConfigError(
        'Cron resource config "only" entries must be task ids (string) or task definitions.',
      );
    }
  }

  return { only };
}
