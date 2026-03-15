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
    const controller = new AbortController();
    const result = asyncContexts.execution.provide(
      { correlationId: "req-seeded", signal: controller.signal },
      () => {
        expect(asyncContexts.execution.has()).toBe(false);
        return "ok";
      },
    );

    expect(result).toBe("ok");
  });

  it("record returns the callback result and no recording without frames", async () => {
    const controller = new AbortController();
    const result = await asyncContexts.execution.record(
      { correlationId: "req-capture-empty", signal: controller.signal },
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

  it("fails fast for provide and record without async local storage", async () => {
    setPlatform(new PlatformAdapter("universal"));
    const controller = new AbortController();

    expect(() =>
      asyncContexts.execution.provide(
        { signal: controller.signal },
        () => "provided",
      ),
    ).toThrow(/Execution context propagation requires AsyncLocalStorage/i);

    try {
      asyncContexts.execution.provide({ signal: controller.signal }, () => "provided");
    } catch (error) {
      expect(contextError.is(error)).toBe(true);
    }

    await expect(
      asyncContexts.execution.record(
        { signal: controller.signal },
        async () => "captured",
      ),
    ).rejects.toThrow(/Execution context propagation requires AsyncLocalStorage/i);
  });
});
