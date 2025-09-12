import { BrowserPlatformAdapter } from "../../platform/adapters/browser";

describe("BrowserPlatformAdapter - timeouts & init", () => {
  it("exposes working setTimeout/clearTimeout bindings", () => {
    const adapter = new BrowserPlatformAdapter();
    const id = adapter.setTimeout(() => {}, 5);
    // The id type is platform-dependent; clearTimeout accepts number | Timer | unknown in Node
    adapter.clearTimeout(id as any);
  });

  it("init is a no-op and is callable", async () => {
    const adapter = new BrowserPlatformAdapter();
    await expect(adapter.init()).resolves.toBeUndefined();
  });
});
