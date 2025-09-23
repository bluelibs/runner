describe("NodePlatformAdapter fallback ALS coverage", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.RUNNER_FORCE_NOOP_ALS;
  });

  it("falls back to no-op ALS when forced via env", async () => {
    process.env.RUNNER_FORCE_NOOP_ALS = "1";
    const { PlatformAdapter } = await import("../../platform");
    const adapter = new PlatformAdapter("node");

    const als = adapter.createAsyncLocalStorage<Map<string, unknown>>();
    // No-op ALS returns undefined store and still runs the callback
    expect(als.getStore()).toBeUndefined();
    const fn = jest.fn(() => undefined);
    expect(() => als.run(new Map(), fn)).not.toThrow();
    expect(fn).toHaveBeenCalled();
  });
});
