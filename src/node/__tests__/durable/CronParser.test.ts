import { CronParser } from "../../durable/core/CronParser";

describe("durable: CronParser", () => {
  it("validates expressions", () => {
    expect(CronParser.isValid("*/5 * * * *")).toBe(true);
    expect(CronParser.isValid("not-a-cron")).toBe(false);
  });

  it("computes next run after a given date", () => {
    const from = new Date("2025-01-01T00:00:00.000Z");
    const next = CronParser.getNextRun("*/5 * * * *", from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("uses the default `from` date when omitted", () => {
    const next = CronParser.getNextRun("*/5 * * * *");
    expect(next).toBeInstanceOf(Date);
  });
});
