import { CronExpressionParser } from "cron-parser";
import { cronConfigurationError } from "./cron.errors";

type CronParseOptions = {
  currentDate?: Date;
  tz?: string;
};

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
      return cronConfigurationError.throw({
        message: `Invalid cron expression \"${expression}\".`,
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

function parseExpression(expression: string, options?: CronParseOptions) {
  return CronExpressionParser.parse(expression, options);
}
