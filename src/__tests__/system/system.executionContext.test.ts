import { asyncContexts } from "../../asyncContexts";
import { contextError } from "../../errors";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";

describe("asyncContexts.execution", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("tryUse returns undefined outside an active execution", () => {
    expect(asyncContexts.execution.tryUse()).toBeUndefined();
    expect(asyncContexts.execution.has()).toBe(false);
  });

  it("use throws outside an active execution", () => {
    expect(() => asyncContexts.execution.use()).toThrow(
      /Execution context is not available/i,
    );
  });

  it("stays unavailable on platforms without async local storage", () => {
    setPlatform(new PlatformAdapter("universal"));
    expect(asyncContexts.execution.tryUse()).toBeUndefined();
  });

  it("provide returns the callback result even when no frames are entered", () => {
    const result = asyncContexts.execution.provide(
      { correlationId: "req-seeded" },
      () => {
        expect(asyncContexts.execution.has()).toBe(false);
        return "ok";
      },
    );

    expect(result).toBe("ok");
  });

  it("record returns the callback result and no recording without frames", async () => {
    const result = await asyncContexts.execution.record(
      { correlationId: "req-capture-empty" },
      async () => "ok",
    );

    expect(result).toEqual({
      result: "ok",
      recording: undefined,
    });
  });

  it("supports the function-only provide/record overloads", async () => {
    expect(asyncContexts.execution.provide(() => "provided")).toBe("provided");

    await expect(
      asyncContexts.execution.record(async () => "captured"),
    ).resolves.toEqual({
      result: "captured",
      recording: undefined,
    });
  });

  it("fails fast when the provide callback is missing", () => {
    expect(() =>
      (
        asyncContexts.execution.provide as unknown as (
          options: { correlationId: string },
          fn?: () => string,
        ) => string
      )({ correlationId: "req-missing" }),
    ).toThrow(/callback is required/i);

    try {
      (
        asyncContexts.execution.provide as unknown as (
          options: { correlationId: string },
          fn?: () => string,
        ) => string
      )({ correlationId: "req-missing" });
    } catch (error) {
      expect(contextError.is(error)).toBe(true);
    }
  });

  it("fails fast when the record callback is missing", () => {
    expect(() =>
      (
        asyncContexts.execution.record as unknown as (
          options: { correlationId: string },
          fn?: () => Promise<string>,
        ) => Promise<unknown>
      )({ correlationId: "req-record-missing" }),
    ).toThrow(/callback is required/i);

    try {
      (
        asyncContexts.execution.record as unknown as (
          options: { correlationId: string },
          fn?: () => Promise<string>,
        ) => Promise<unknown>
      )({ correlationId: "req-record-missing" });
    } catch (error) {
      expect(contextError.is(error)).toBe(true);
    }
  });

  it("provide and record still return callback results without async local storage", async () => {
    setPlatform(new PlatformAdapter("universal"));

    expect(asyncContexts.execution.provide(() => "provided")).toBe("provided");
    await expect(
      asyncContexts.execution.record(async () => "captured"),
    ).resolves.toEqual({
      result: "captured",
      recording: undefined,
    });
  });
});
