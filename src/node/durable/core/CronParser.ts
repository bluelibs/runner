import { CronExpressionParser } from "cron-parser";
import { durableScheduleConfigError } from "../../../errors";

export class CronParser {
  static getNextRun(expression: string, from: Date = new Date()): Date {
    try {
      const interval = parseExpression(expression, { currentDate: from });
      return interval.next().toDate();
    } catch {
      return durableScheduleConfigError.throw({
        message: `Invalid cron expression '${expression}'.`,
      });
    }
  }

  static isValid(expression: string): boolean {
    try {
      parseExpression(expression);
      return true;
    } catch {
      return false;
    }
  }
}

function parseExpression(
  expression: string,
  options?: { currentDate?: Date },
): {
  next: () => { toDate: () => Date };
} {
  return CronExpressionParser.parse(expression, options);
}
