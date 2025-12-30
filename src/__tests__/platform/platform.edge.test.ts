import { EdgePlatformAdapter } from "../../platform/adapters/edge";

describe("EdgePlatformAdapter", () => {
  it("should extend BrowserPlatformAdapter", () => {
    const adapter = new EdgePlatformAdapter();

    // EdgePlatformAdapter inherits all methods from BrowserPlatformAdapter
    expect(adapter.onUncaughtException).toBeDefined();
    expect(adapter.onUnhandledRejection).toBeDefined();
    expect(adapter.exit).toBeDefined();
    expect(adapter.getEnv).toBeDefined();
  });

  it("should return a no-op disposer for onShutdownSignal", () => {
    const adapter = new EdgePlatformAdapter();
    const mockHandler = jest.fn();

    const disposer = adapter.onShutdownSignal(mockHandler);

    // The disposer should be a function that does nothing
    expect(typeof disposer).toBe("function");

    // Calling the disposer should not throw
    expect(() => disposer()).not.toThrow();

    // The handler should not be called immediately
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("should not trigger shutdown signal in workers", () => {
    const adapter = new EdgePlatformAdapter();
    const mockHandler = jest.fn();

    // Register a shutdown handler
    const disposer = adapter.onShutdownSignal(mockHandler);

    // Since this is edge runtime (workers), no shutdown signal should be available
    // and the handler should never be called
    expect(mockHandler).not.toHaveBeenCalled();

    // Cleanup should work without issues
    disposer();
  });
});
