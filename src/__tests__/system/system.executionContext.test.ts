import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";
import { system } from "../../system";

describe("system.ctx.executionContext", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("tryUse returns undefined outside an active execution", () => {
    expect(system.ctx.executionContext.tryUse()).toBeUndefined();
  });

  it("use throws outside an active execution", () => {
    expect(() => system.ctx.executionContext.use()).toThrow(
      /Execution context is not available/i,
    );
  });

  it("stays unavailable on platforms without async local storage", () => {
    setPlatform(new PlatformAdapter("universal"));
    expect(system.ctx.executionContext.tryUse()).toBeUndefined();
  });

  it("provide returns the callback result even when no frames are entered", () => {
    const result = system.ctx.executionContext.provide(
      { correlationId: "req-seeded" },
      () => "ok",
    );

    expect(result).toBe("ok");
  });

  it("record returns the callback result and no recording without frames", async () => {
    const result = await system.ctx.executionContext.record(
      { correlationId: "req-capture-empty" },
      async () => "ok",
    );

    expect(result).toEqual({
      result: "ok",
      recording: undefined,
    });
  });

  it("supports the function-only provide/record overloads", async () => {
    expect(system.ctx.executionContext.provide(() => "provided")).toBe(
      "provided",
    );

    await expect(
      system.ctx.executionContext.record(async () => "captured"),
    ).resolves.toEqual({
      result: "captured",
      recording: undefined,
    });
  });

  it("provide and record still return callback results without async local storage", async () => {
    setPlatform(new PlatformAdapter("universal"));

    expect(system.ctx.executionContext.provide(() => "provided")).toBe(
      "provided",
    );
    await expect(
      system.ctx.executionContext.record(async () => "captured"),
    ).resolves.toEqual({
      result: "captured",
      recording: undefined,
    });
  });
});
