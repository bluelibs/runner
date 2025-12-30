import { createPlatformAdapter } from "../../platform/factory";
import { UniversalPlatformAdapter } from "../../platform/adapters/universal";

describe("Platform Factory", () => {
  it("should create a platform adapter", () => {
    const adapter = createPlatformAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.init).toBe("function");
    expect(typeof adapter.onUncaughtException).toBe("function");
    expect(typeof adapter.onUnhandledRejection).toBe("function");
    expect(typeof adapter.onShutdownSignal).toBe("function");
    expect(typeof adapter.exit).toBe("function");
    expect(typeof adapter.getEnv).toBe("function");
    expect(typeof adapter.hasAsyncLocalStorage).toBe("function");
    expect(typeof adapter.createAsyncLocalStorage).toBe("function");
  });

  it("should return UniversalPlatformAdapter in test environment (default case)", () => {
    // In test environment without __TARGET__ defined, should fallback to UniversalPlatformAdapter
    const adapter = createPlatformAdapter();
    expect(adapter).toBeInstanceOf(UniversalPlatformAdapter);
  });

  it("should return same type on multiple calls", () => {
    const adapter1 = createPlatformAdapter();
    const adapter2 = createPlatformAdapter();

    // Should return same type (but different instances)
    expect(adapter1.constructor).toBe(adapter2.constructor);
  });
});
