import { createMessageError } from "../../errors";

describe("NodePlatformAdapter builtin async_hooks lookup failure coverage", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("handles builtin lookup failure and falls back to no-op", async () => {
    const { PlatformAdapter } = await import("../../platform");
    const adapter = new PlatformAdapter("node");
    jest.spyOn(process, "getBuiltinModule").mockImplementation(() => {
      throw createMessageError("fail");
    });
    const als = adapter.createAsyncLocalStorage<Map<string, unknown>>();
    expect(als.getStore()).toBeUndefined();
    expect(() => als.run(new Map(), () => undefined)).not.toThrow();
  });
});
