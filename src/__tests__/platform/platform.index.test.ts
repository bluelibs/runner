import {
  getPlatform,
  setPlatform,
  resetPlatform,
  getDetectedEnvironment,
  isNode,
  isBrowser,
  isEdge,
  isUniversal,
  PlatformAdapter,
} from "../../platform";
import { NodePlatformAdapter } from "../../platform/adapters/node";
import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import { UniversalPlatformAdapter } from "../../platform/adapters/universal";
import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";

interface TestGlobal {
  __TARGET__?: string;
}
const testGlobal = globalThis as unknown as TestGlobal;

function getInner(adapter: PlatformAdapter) {
  return (adapter as unknown as { inner: any }).inner;
}

describe("Platform Index", () => {
  afterEach(() => {
    resetPlatform();
  });

  describe("getPlatform", () => {
    it("should return same instance on multiple calls", () => {
      const platform1 = getPlatform();
      const platform2 = getPlatform();
      expect(platform1).toBe(platform2);
    });

    it("should create platform instance using factory", () => {
      const platform = getPlatform();
      expect(platform).toBeDefined();
      expect(typeof platform.init).toBe("function");
    });
  });

  describe("setPlatform", () => {
    it("should set custom platform adapter", () => {
      const customAdapter = new NodePlatformAdapter();
      setPlatform(customAdapter);

      const platform = getPlatform();
      expect(platform).toBe(customAdapter);
    });

    it("should override previously created platform", () => {
      const firstPlatform = getPlatform();
      const customAdapter = new BrowserPlatformAdapter();

      setPlatform(customAdapter);
      const secondPlatform = getPlatform();

      expect(secondPlatform).toBe(customAdapter);
      expect(secondPlatform).not.toBe(firstPlatform);
    });
  });

  describe("resetPlatform", () => {
    it("should reset platform instance", () => {
      const platform1 = getPlatform();
      resetPlatform();
      const platform2 = getPlatform();

      expect(platform1).not.toBe(platform2);
    });

    it("should reset detected environment", () => {
      getDetectedEnvironment();
      resetPlatform();

      // The environment should be re-detected on next call
      const env = getDetectedEnvironment();
      expect(env).toBeDefined();
    });
  });

  describe("getDetectedEnvironment", () => {
    it("should detect and cache environment", () => {
      const env1 = getDetectedEnvironment();
      const env2 = getDetectedEnvironment();

      expect(env1).toBe(env2);
      expect(["node", "browser", "universal", "edge"]).toContain(env1);
    });

    it("should re-detect after reset", () => {
      const env1 = getDetectedEnvironment();
      resetPlatform();
      const env2 = getDetectedEnvironment();

      // They should be equal since we're in the same environment
      // but the detection logic should have run again
      expect(env1).toBe(env2);
    });
  });

  describe("environment checks", () => {
    describe("isNode", () => {
      it("should return true only for node environment", () => {
        const result = isNode();
        expect(typeof result).toBe("boolean");

        // In test environment, this is likely to be true
        if (getDetectedEnvironment() === "node") {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      });
    });

    describe("isBrowser", () => {
      it("should return true only for browser environment", () => {
        const result = isBrowser();
        expect(typeof result).toBe("boolean");

        if (getDetectedEnvironment() === "browser") {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      });
    });

    describe("isUniversal", () => {
      it("should return true only for universal environment", () => {
        const result = isUniversal();
        expect(typeof result).toBe("boolean");

        if (getDetectedEnvironment() === "universal") {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      });
    });
  });

  describe("__TARGET__ = universal cases", () => {
    let originalTarget: any;

    beforeAll(() => {
      originalTarget = testGlobal.__TARGET__;
      testGlobal.__TARGET__ = "universal";
    });

    afterAll(() => {
      if (originalTarget !== undefined) {
        testGlobal.__TARGET__ = originalTarget;
      } else {
        delete testGlobal.__TARGET__;
      }
    });

    beforeEach(() => {
      resetPlatform();
    });

    it("should call detectEnvironment when __TARGET__ is universal", () => {
      const env = getDetectedEnvironment();
      expect(env).toBeDefined();
      expect(["node", "browser", "universal", "edge"]).toContain(env);
    });

    it("should use runtime detection in isNode when __TARGET__ is universal", () => {
      const result = isNode();
      expect(typeof result).toBe("boolean");
      expect(result).toBe(getDetectedEnvironment() === "node");
    });

    it("should use runtime detection in isBrowser when __TARGET__ is universal", () => {
      const result = isBrowser();
      expect(typeof result).toBe("boolean");
      expect(result).toBe(getDetectedEnvironment() === "browser");
    });

    it("should use runtime detection in isUniversal when __TARGET__ is universal", () => {
      const result = isUniversal();
      expect(typeof result).toBe("boolean");
      expect(result).toBe(getDetectedEnvironment() === "universal");
    });
  });

  describe("PlatformAdapter", () => {
    it("should create NodePlatformAdapter for node environment", () => {
      const adapter = new PlatformAdapter("node");
      expect(adapter.env).toBe("node");
      expect(getInner(adapter)).toBeInstanceOf(NodePlatformAdapter);
    });

    it("should create BrowserPlatformAdapter for browser environment", () => {
      const adapter = new PlatformAdapter("browser");
      expect(adapter.env).toBe("browser");
      expect(getInner(adapter)).toBeInstanceOf(BrowserPlatformAdapter);
    });

    it("should create EdgePlatformAdapter for edge environment", () => {
      const adapter = new PlatformAdapter("edge");
      expect(adapter.env).toBe("edge");
      expect(getInner(adapter)).toBeInstanceOf(EdgePlatformAdapter);
    });

    it("should create GenericUniversalPlatformAdapter for universal environment", () => {
      const adapter = new PlatformAdapter("universal");
      expect(adapter.env).toBe("universal");
      expect(getInner(adapter)).toBeInstanceOf(GenericUniversalPlatformAdapter);
    });

    it("should create UniversalPlatformAdapter for unknown environment", () => {
      const adapter = new PlatformAdapter("unknown" as any);
      expect(adapter.env).toBe("unknown");
      expect(getInner(adapter)).toBeInstanceOf(UniversalPlatformAdapter);
    });

    it("should detect environment when no env is provided", () => {
      const adapter = new PlatformAdapter();
      expect(["node", "browser", "universal", "edge"]).toContain(adapter.env);
    });

    it("should delegate init to inner adapter", async () => {
      const adapter = new PlatformAdapter("node");
      const initSpy = jest.spyOn(getInner(adapter), "init");

      await adapter.init();
      expect(initSpy).toHaveBeenCalled();
    });

    it("should delegate onUncaughtException to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn(getInner(adapter), "onUncaughtException");

      adapter.onUncaughtException(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate onUnhandledRejection to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn(getInner(adapter), "onUnhandledRejection");

      adapter.onUnhandledRejection(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate onShutdownSignal to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn(getInner(adapter), "onShutdownSignal");

      adapter.onShutdownSignal(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate exit to inner adapter", () => {
      const adapter = new PlatformAdapter("browser"); // Use browser instead of node to avoid process.exit
      const spy = jest.spyOn(getInner(adapter), "exit");

      try {
        adapter.exit(1);
      } catch {
        // May throw in some adapters
      }
      expect(spy).toHaveBeenCalledWith(1);
    });

    it("should delegate getEnv to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn(getInner(adapter), "getEnv");

      adapter.getEnv("TEST_KEY");
      expect(spy).toHaveBeenCalledWith("TEST_KEY");
    });

    it("should delegate hasAsyncLocalStorage to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn(getInner(adapter), "hasAsyncLocalStorage");

      adapter.hasAsyncLocalStorage();
      expect(spy).toHaveBeenCalled();
    });

    it("should delegate createAsyncLocalStorage to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn(getInner(adapter), "createAsyncLocalStorage");

      adapter.createAsyncLocalStorage();
      expect(spy).toHaveBeenCalled();
    });

    it("should use globalThis timeout methods", () => {
      const adapter = new PlatformAdapter("node");
      expect(adapter.setTimeout).toBe(globalThis.setTimeout);
      expect(adapter.clearTimeout).toBe(globalThis.clearTimeout);
    });
  });

  describe("__TARGET__ build-time target cases", () => {
    let originalTarget: any;

    beforeEach(() => {
      originalTarget = testGlobal.__TARGET__;
      resetPlatform();
    });

    afterEach(() => {
      if (originalTarget !== undefined) {
        testGlobal.__TARGET__ = originalTarget;
      } else {
        delete testGlobal.__TARGET__;
      }
    });

    describe("__TARGET__ = node", () => {
      beforeEach(() => {
        testGlobal.__TARGET__ = "node";
      });

      it("should use node as detected environment when __TARGET__ is node", () => {
        const env = getDetectedEnvironment();
        expect(env).toBe("node");
      });

      it("should return true for isNode() when __TARGET__ is node", () => {
        expect(isNode()).toBe(true);
      });

      it("should return false for isBrowser() when __TARGET__ is node", () => {
        expect(isBrowser()).toBe(false);
      });

      it("should return false for isUniversal() when __TARGET__ is node", () => {
        expect(isUniversal()).toBe(false);
      });

      it("should return false for isEdge() when __TARGET__ is node", () => {
        expect(isEdge()).toBe(false);
      });
    });

    describe("__TARGET__ = browser", () => {
      beforeEach(() => {
        testGlobal.__TARGET__ = "browser";
      });

      it("should use browser as detected environment when __TARGET__ is browser", () => {
        const env = getDetectedEnvironment();
        expect(env).toBe("browser");
      });

      it("should return false for isNode() when __TARGET__ is browser", () => {
        expect(isNode()).toBe(false);
      });

      it("should return true for isBrowser() when __TARGET__ is browser", () => {
        expect(isBrowser()).toBe(true);
      });

      it("should return false for isUniversal() when __TARGET__ is browser", () => {
        expect(isUniversal()).toBe(false);
      });

      it("should return false for isEdge() when __TARGET__ is browser", () => {
        expect(isEdge()).toBe(false);
      });
    });

    describe("__TARGET__ = edge", () => {
      beforeEach(() => {
        testGlobal.__TARGET__ = "edge";
      });

      it("should use edge as detected environment when __TARGET__ is edge", () => {
        const env = getDetectedEnvironment();
        expect(env).toBe("edge");
      });

      it("should return false for isNode() when __TARGET__ is edge", () => {
        expect(isNode()).toBe(false);
      });

      it("should return false for isBrowser() when __TARGET__ is edge", () => {
        expect(isBrowser()).toBe(false);
      });

      it("should return false for isUniversal() when __TARGET__ is edge", () => {
        expect(isUniversal()).toBe(false);
      });

      it("should return true for isEdge() when __TARGET__ is edge", () => {
        expect(isEdge()).toBe(true);
      });
    });

    describe("__TARGET__ = universal", () => {
      beforeEach(() => {
        testGlobal.__TARGET__ = "universal";
      });

      it("should use runtime detection when __TARGET__ is universal", () => {
        const env = getDetectedEnvironment();
        // When __TARGET__ is "universal", it should use runtime detection
        expect(["node", "browser", "universal", "edge"]).toContain(env);
      });

      it("should use runtime detection in isNode() when __TARGET__ is universal", () => {
        const result = isNode();
        expect(typeof result).toBe("boolean");
        expect(result).toBe(getDetectedEnvironment() === "node");
      });

      it("should use runtime detection in isBrowser() when __TARGET__ is universal", () => {
        const result = isBrowser();
        expect(typeof result).toBe("boolean");
        expect(result).toBe(getDetectedEnvironment() === "browser");
      });

      it("should use runtime detection in isUniversal() when __TARGET__ is universal", () => {
        const result = isUniversal();
        expect(typeof result).toBe("boolean");
        expect(result).toBe(getDetectedEnvironment() === "universal");
      });

      it("should use runtime detection in isEdge() when __TARGET__ is universal", () => {
        const result = isEdge();
        expect(typeof result).toBe("boolean");
        expect(result).toBe(getDetectedEnvironment() === "edge");
      });
    });

    describe("__TARGET__ undefined cases", () => {
      beforeEach(() => {
        testGlobal.__TARGET__ = undefined;
      });

      it("should use node as detected environment when __TARGET__ is undefined", () => {
        const env = getDetectedEnvironment();
        expect(env).toBe("node");
      });

      it("should return true for isNode() when __TARGET__ is undefined", () => {
        expect(isNode()).toBe(true);
      });

      it("should return false for isBrowser() when __TARGET__ is undefined", () => {
        expect(isBrowser()).toBe(false);
      });

      it("should return false for isUniversal() when __TARGET__ is undefined", () => {
        expect(isUniversal()).toBe(false);
      });

      it("should return false for isEdge() when __TARGET__ is undefined", () => {
        expect(isEdge()).toBe(false);
      });
    });
  });
});
