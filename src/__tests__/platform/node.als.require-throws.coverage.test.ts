describe("NodePlatformAdapter require('async_hooks') throws coverage", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("handles require failure and falls back to no-op", async () => {
    jest.doMock("async_hooks", () => {
      throw new Error("fail");
    });

    const { PlatformAdapter } = await import("../../platform");
    const adapter = new PlatformAdapter("node");
    const als = adapter.createAsyncLocalStorage<Map<string, unknown>>();
    expect(als.getStore()).toBeUndefined();
    expect(() => als.run(new Map(), () => undefined)).not.toThrow();
  });
});

