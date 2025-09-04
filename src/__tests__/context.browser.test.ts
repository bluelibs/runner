import { jest } from "@jest/globals";

describe("createContext in browser mode", () => {
  afterEach(() => {
    // restore globals if tests modified them
    (globalThis as any).window && delete (globalThis as any).window;
    (globalThis as any).document && delete (globalThis as any).document;
    // Reset platform singleton between tests
    const { resetPlatform } = require("../platform");
    resetPlatform();
    jest.resetModules();
  });

  it("works when forcing BrowserPlatformAdapter via setPlatform", async () => {
    await jest.isolateModulesAsync(async () => {
      const { setPlatform, BrowserPlatformAdapter } = await import("../platform");
      setPlatform(new BrowserPlatformAdapter());

      const { createContext, ContextError } = await import("../context");

      const UserCtx = createContext<{ id: string }>("user");

      // Outside provide should throw
      expect(() => UserCtx.use()).toThrow(ContextError);

      // Basic provide/use
      await UserCtx.provide({ id: "u1" }, async () => {
        expect(UserCtx.use()).toEqual({ id: "u1" });
      });

      // Nested provide overrides value only inside inner scope
      await UserCtx.provide({ id: "outer" }, async () => {
        expect(UserCtx.use()).toEqual({ id: "outer" });
        await UserCtx.provide({ id: "inner" }, async () => {
          expect(UserCtx.use()).toEqual({ id: "inner" });
        });
        expect(UserCtx.use()).toEqual({ id: "outer" });
      });
    });
  });

  it("detects browser adapter when window/document exist and process is absent", async () => {
    await jest.isolateModulesAsync(async () => {
      // Simulate browser-like globals
      delete (globalThis as any).process;
      (globalThis as any).window = {};
      (globalThis as any).document = {};

      const { resetPlatform, getPlatform, BrowserPlatformAdapter } = await import(
        "../platform"
      );
      resetPlatform();
      const adapter = getPlatform();
      expect(adapter).toBeInstanceOf(BrowserPlatformAdapter);

      const { createContext } = await import("../context");
      const Ctx = createContext<number>("n");
      let seen: number | undefined;
      Ctx.provide(7, () => {
        seen = Ctx.use();
      });
      expect(seen).toBe(7);
    });
  });
});

