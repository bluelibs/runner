describe("Platform Factory - Ultimate Coverage", () => {
  it("should hit all switch cases by manually defining __TARGET__", () => {
    // Save original state
    const originalTarget = (globalThis as any).__TARGET__;
    
    try {
      // Test node case
      (globalThis as any).__TARGET__ = "node";
      // Need to re-require to get fresh import with new __TARGET__
      delete require.cache[require.resolve("../../platform/factory")];
      const { createPlatformAdapter: createNode } = require("../../platform/factory");
      const { NodePlatformAdapter } = require("../../platform/adapters/node");
      
      const nodeAdapter = createNode();
      expect(nodeAdapter).toBeInstanceOf(NodePlatformAdapter);
      
      // Test browser case
      (globalThis as any).__TARGET__ = "browser";
      delete require.cache[require.resolve("../../platform/factory")];
      const { createPlatformAdapter: createBrowser } = require("../../platform/factory");
      const { BrowserPlatformAdapter } = require("../../platform/adapters/browser");
      
      const browserAdapter = createBrowser();
      expect(browserAdapter).toBeInstanceOf(BrowserPlatformAdapter);
      
      // Test edge case
      (globalThis as any).__TARGET__ = "edge";
      delete require.cache[require.resolve("../../platform/factory")];
      const { createPlatformAdapter: createEdge } = require("../../platform/factory");
      const { EdgePlatformAdapter } = require("../../platform/adapters/edge");
      
      const edgeAdapter = createEdge();
      expect(edgeAdapter).toBeInstanceOf(EdgePlatformAdapter);
      
    } finally {
      // Restore
      if (originalTarget !== undefined) {
        (globalThis as any).__TARGET__ = originalTarget;
      } else {
        delete (globalThis as any).__TARGET__;
      }
      
      // Clear require cache to avoid pollution
      delete require.cache[require.resolve("../../platform/factory")];
    }
  });
});