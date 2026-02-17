import { createRequire } from "node:module";
import { join } from "node:path";
import { durableScheduleConfigError } from "../../../errors";

/**
 * Cron helper used by `ScheduleManager`.
 *
 * Prefers the optional `cron-parser` dependency when available, but provides a
 * deterministic fallback implementation so durable scheduling works even when
 * optional deps are not installed (important for the multi-platform packaging
 * and optionalDependency setup).
 */
export class CronParser {
  static getNextRun(cron: string, from: Date = new Date()): Date {
    const external = CronParser.tryGetExternalParser();
    if (external) {
      const interval = external.parse(cron, { currentDate: from });
      return interval.next().toDate();
    }

    return CronParser.getNextRunFallback(cron, from);
  }

  static isValid(cron: string): boolean {
    try {
      const external = CronParser.tryGetExternalParser();
      if (external) {
        external.parse(cron);
        return true;
      }
      CronParser.parseFallback(cron);
      return true;
    } catch {
      return false;
    }
  }

  private static tryGetExternalParser(): {
    parse: (
      cron: string,
      options?: { currentDate?: Date },
    ) => { next: () => { toDate: () => Date } };
  } | null {
    type CronParserModule = {
      CronExpressionParser?: unknown;
      default?: unknown;
    };

    try {
      const requireFn = createRequire(
        join(process.cwd(), "__runner_require__.js"),
      );

      const mod = requireFn("cron-parser") as CronParserModule;
      const candidate =
        (mod && mod.CronExpressionParser) ||
        (mod &&
          (mod.default as CronParserModule | undefined)
            ?.CronExpressionParser) ||
        mod.default ||
        mod;

      if (!candidate || typeof candidate !== "object") return null;
      const parser = candidate as { parse?: unknown };
      if (typeof parser.parse !== "function") return null;

      return parser as {
        parse: (
          cron: string,
          options?: { currentDate?: Date },
        ) => { next: () => { toDate: () => Date } };
      };
    } catch {
      return null;
    }
  }

  private static parseFallback(cron: string): {
    minute: CronField;
    hour: CronField;
    dayOfMonth: CronField;
    month: CronField;
    dayOfWeek: CronField;
  } {
    const parts = cron.trim().split(/\s+/g);
    if (parts.length !== 5) {
      durableScheduleConfigError.throw({
        message: `Invalid cron expression (expected 5 fields): '${cron}'`,
      });
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    return {
      minute: parseField(minute, { min: 0, max: 59, name: "minute" }),
      hour: parseField(hour, { min: 0, max: 23, name: "hour" }),
      dayOfMonth: parseField(dayOfMonth, {
        min: 1,
        max: 31,
        name: "dayOfMonth",
      }),
      month: parseField(month, { min: 1, max: 12, name: "month" }),
      dayOfWeek: parseField(dayOfWeek, { min: 0, max: 7, name: "dayOfWeek" }),
    };
  }

  private static getNextRunFallback(cron: string, from: Date): Date {
    const spec = CronParser.parseFallback(cron);

    const cursor = new Date(from.getTime());
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    const maxMinutesToScan = 366 * 24 * 60;
    for (let i = 0; i < maxMinutesToScan; i += 1) {
      if (matches(spec, cursor)) return cursor;
      cursor.setMinutes(cursor.getMinutes() + 1);
    }

    return durableScheduleConfigError.throw({
      message: `Cron expression did not match any time within 366 days: '${cron}'`,
    });
  }
}

type CronField =
  | { kind: "any" }
  | { kind: "value"; value: number }
  | { kind: "step"; step: number };

function parseField(
  raw: string,
  range: { min: number; max: number; name: string },
): CronField {
  if (raw === "*") return { kind: "any" };

  const stepMatch = raw.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isInteger(step) || step <= 0) {
      durableScheduleConfigError.throw({
        message: `Invalid ${range.name} step: '${raw}'`,
      });
    }
    return { kind: "step", step };
  }

  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      durableScheduleConfigError.throw({
        message: `Invalid ${range.name} value: '${raw}'`,
      });
    }
    return { kind: "value", value };
  }

  return durableScheduleConfigError.throw({
    message: `Unsupported ${range.name} field '${raw}' (supported: '*', '*/n', 'n')`,
  });
}

function matches(
  spec: {
    minute: CronField;
    hour: CronField;
    dayOfMonth: CronField;
    month: CronField;
    dayOfWeek: CronField;
  },
  date: Date,
): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay(); // 0..6 (Sun..Sat)

  return (
    matchField(spec.minute, minute) &&
    matchField(spec.hour, hour) &&
    matchField(spec.dayOfMonth, dayOfMonth) &&
    matchField(spec.month, month) &&
    matchDayOfWeek(spec.dayOfWeek, dayOfWeek)
  );
}

function matchField(field: CronField, value: number): boolean {
  if (field.kind === "any") return true;
  if (field.kind === "value") return field.value === value;
  return value % field.step === 0;
}

function matchDayOfWeek(field: CronField, dayOfWeek: number): boolean {
  if (field.kind === "any") return true;
  if (field.kind === "value") {
    const normalized = field.value === 7 ? 0 : field.value;
    return normalized === dayOfWeek;
  }
  return dayOfWeek % field.step === 0;
}
