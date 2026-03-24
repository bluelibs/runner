import { CronExpressionParser } from "cron-parser";
import { CronParser } from "../../durable/core/CronParser";

describe("durable: CronParser", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates expressions", () => {
    expect(CronParser.isValid("*/5 * * * *")).toBe(true);
    expect(CronParser.isValid("0 9 * * *", "UTC")).toBe(true);
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

  it("shifts UTC execution time across DST when timezone is explicit", () => {
    expect(
      CronParser.getNextRun(
        "0 9 * * *",
        new Date("2027-03-13T13:30:00.000Z"),
        "America/New_York",
      ).toISOString(),
    ).toBe("2027-03-13T14:00:00.000Z");

    expect(
      CronParser.getNextRun(
        "0 9 * * *",
        new Date("2027-03-14T12:30:00.000Z"),
        "America/New_York",
      ).toISOString(),
    ).toBe("2027-03-14T13:00:00.000Z");
  });

  it("throws a durable config error for invalid expressions", () => {
    expect(() => CronParser.getNextRun("not-a-cron")).toThrow(
      /invalid cron expression/i,
    );
  });
});
