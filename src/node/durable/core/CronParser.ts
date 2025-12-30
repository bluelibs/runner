import { CronExpressionParser } from "cron-parser";

export class CronParser {
  static getNextRun(cron: string, from: Date = new Date()): Date {
    const interval = CronExpressionParser.parse(cron, { currentDate: from });
    return interval.next().toDate();
  }

  static isValid(cron: string): boolean {
    try {
      CronExpressionParser.parse(cron);
      return true;
    } catch {
      return false;
    }
  }
}
