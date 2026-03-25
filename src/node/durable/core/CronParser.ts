import { CronExpressionParser } from "cron-parser";
import { durableScheduleConfigError } from "../../../errors";

export class CronParser {
  static getNextRun(
    expression: string,
    from: Date = new Date(),
    timezone?: string,
  ): Date {
    try {
      const interval = parseExpression(expression, {
        currentDate: from,
        tz: timezone,
      });
      return interval.next().toDate();
    } catch {
      return durableScheduleConfigError.throw({
        message: timezone
          ? `Invalid cron expression '${expression}' for timezone '${timezone}'.`
          : `Invalid cron expression '${expression}'.`,
      });
    }
  }

  static isValid(expression: string, timezone?: string): boolean {
    try {
      parseExpression(expression, { tz: timezone });
      return true;
    } catch {
      return false;
    }
  }
}

function parseExpression(
  expression: string,
  options?: { currentDate?: Date; tz?: string },
): {
  next: () => { toDate: () => Date };
} {
  return CronExpressionParser.parse(expression, options);
}
