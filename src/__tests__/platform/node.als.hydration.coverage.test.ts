import { PlatformAdapter } from "../../platform";

describe("NodePlatformAdapter hydration path coverage", () => {
  it("hydrates ALS via require('async_hooks') when init not awaited", () => {
    const adapter = new PlatformAdapter("node");
    const als = adapter.createAsyncLocalStorage<string>();

    // Ensure ensure() path executes without forcing noop
    expect(als.getStore()).toBeUndefined();
    expect(() => als.run("value", () => undefined)).not.toThrow();
  });
});
