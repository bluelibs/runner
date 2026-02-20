import { cronTag } from "../../globals/cron/cron.tag";
import { CronOnError } from "../../globals/types";

describe("cronTag", () => {
  it("accepts valid configs", () => {
    const configured = cronTag.with({
      expression: "* * * * *",
      timezone: "UTC",
      immediate: true,
      enabled: true,
      onError: CronOnError.Continue,
      input: { key: "value" },
    });

    expect(configured.config.expression).toBe("* * * * *");
    expect(configured.config.timezone).toBe("UTC");
    expect(configured.config.immediate).toBe(true);
    expect(configured.config.enabled).toBe(true);
    expect(configured.config.onError).toBe(CronOnError.Continue);
    expect(configured.config.input).toEqual({ key: "value" });
  });

  it("rejects invalid configs", () => {
    expect(() => cronTag.with(null as never)).toThrow(/must be an object/i);
    expect(() => cronTag.with({} as never)).toThrow(/non-empty "expression"/i);
    expect(() => cronTag.with({ expression: "" } as never)).toThrow(
      /non-empty "expression"/i,
    );
    expect(() =>
      cronTag.with({ expression: "* * * * *", timezone: "" }),
    ).toThrow(/timezone/i);
    expect(() =>
      cronTag.with({ expression: "* * * * *", immediate: "yes" } as never),
    ).toThrow(/immediate/i);
    expect(() =>
      cronTag.with({ expression: "* * * * *", enabled: "yes" } as never),
    ).toThrow(/enabled/i);
    expect(() =>
      cronTag.with({ expression: "* * * * *", onError: "nope" } as never),
    ).toThrow(/onError/i);
    expect(() =>
      cronTag.with({ expression: "* * * * *", silent: "yes" } as never),
    ).toThrow(/silent/i);
  });
});
