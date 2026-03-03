import { defineTask } from "../../define";
import {
  parseCronResourceConfig,
  resolveOnlySet,
} from "../../globals/cron/parseCronResourceConfig";

describe("cron parse config helpers", () => {
  it("keeps explicit ids when no resolver is provided", () => {
    const task = defineTask({
      id: "cron.parse.helpers.task",
      run: async () => undefined,
    });

    const onlySet = resolveOnlySet([task, "cron.parse.helpers.raw.id"]);
    expect(Array.from(onlySet.values()).sort()).toEqual([
      "cron.parse.helpers.raw.id",
      "cron.parse.helpers.task",
    ]);
  });

  it("falls back to entry ids when resolver returns undefined", () => {
    const task = defineTask({
      id: "cron.parse.helpers.resolver-fallback.task",
      run: async () => undefined,
    });

    const onlySet = resolveOnlySet(
      [task, "cron.parse.helpers.resolver-fallback.raw"],
      (entry) => {
        if (typeof entry === "string") {
          return undefined;
        }
        return `resolved:${entry.id}`;
      },
    );

    expect(Array.from(onlySet.values()).sort()).toEqual([
      "cron.parse.helpers.resolver-fallback.raw",
      "resolved:cron.parse.helpers.resolver-fallback.task",
    ]);
  });

  it("fails fast when entries resolve to empty ids", () => {
    const task = defineTask({
      id: "cron.parse.helpers.empty-id.task",
      run: async () => undefined,
    });

    expect(() => resolveOnlySet([task], () => "")).toThrow(
      /resolved to an empty id/i,
    );
  });

  it("fails fast when task entries cannot be resolved by resolver", () => {
    const task = defineTask({
      id: "cron.parse.helpers.unresolved.task",
      run: async () => undefined,
    });

    expect(() => resolveOnlySet([task], () => undefined)).toThrow(
      /could not be resolved to a canonical id/i,
    );
  });

  it("parses undefined as empty config", () => {
    expect(parseCronResourceConfig(undefined)).toEqual({});
  });
});
