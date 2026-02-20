import { CronExpressionParser } from "cron-parser";
import { CronParser } from "../../globals/cron/cron-parser";

describe("CronParser", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates cron expressions through cron-parser", () => {
    expect(CronParser.isValid("* * * * *")).toBe(true);
    expect(CronParser.isValid("*/5 * * * *", "UTC")).toBe(true);
    expect(CronParser.isValid("invalid")).toBe(false);
  });

  it("computes the next run from a given date", () => {
    const from = new Date("2026-01-01T00:00:15.000Z");
    const next = CronParser.getNextRun("*/5 * * * *", from);

    expect(next.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("passes timezone to cron-parser", () => {
    const expected = new Date("2030-03-03T03:03:00.000Z");
    const parseSpy = jest.spyOn(CronExpressionParser, "parse");
    parseSpy.mockReturnValue({
      next: () => ({ toDate: () => expected }),
    } as ReturnType<typeof CronExpressionParser.parse>);

    const result = CronParser.getNextRun("0 3 * * *", new Date(), "UTC");
    expect(result).toBe(expected);
    expect(parseSpy).toHaveBeenCalledWith("0 3 * * *", {
      currentDate: expect.any(Date),
      tz: "UTC",
    });
  });

  it("throws a cron configuration error for invalid expressions", () => {
    expect(() => CronParser.getNextRun("invalid expression")).toThrow(
      /invalid cron expression/i,
    );
  });
});
