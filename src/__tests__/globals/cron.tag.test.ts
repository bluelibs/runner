import { cronTag } from "../../globals/cron/cron.tag";
import { CronOnError } from "../../globals/types";
import { RunnerError } from "../../definers/defineError";

describe("cronTag", () => {
  const expectValidationError = (fn: () => unknown): void => {
    try {
      fn();
      throw new Error("Expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
    }
  };

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
    expectValidationError(() => cronTag.with(null as never));
    expectValidationError(() => cronTag.with({} as never));
    expectValidationError(() => cronTag.with({ expression: "" } as never));
    expectValidationError(() =>
      cronTag.with({ expression: "* * * * *", timezone: "" }),
    );
    expectValidationError(() =>
      cronTag.with({ expression: "* * * * *", immediate: "yes" } as never),
    );
    expectValidationError(() =>
      cronTag.with({ expression: "* * * * *", enabled: "yes" } as never),
    );
    expectValidationError(() =>
      cronTag.with({ expression: "* * * * *", onError: "nope" } as never),
    );
    expectValidationError(() =>
      cronTag.with({ expression: "* * * * *", silent: "yes" } as never),
    );
  });
});
