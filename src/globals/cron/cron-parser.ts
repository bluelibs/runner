import { CronExpressionParser } from "cron-parser";
import { validationError } from "../../errors";

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
      return validationError.throw({
        subject: "Cron expression",
        id: "globals.resources.cron",
        originalError: `Invalid cron expression "${expression}".`,
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
