import { 
  getPlatform, 
  setPlatform, 
  resetPlatform, 
  getDetectedEnvironment,
  isNode,
  isBrowser,
  isUniversal,
  PlatformAdapter
} from "../../platform";
import { NodePlatformAdapter } from "../../platform/adapters/node";
import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import { UniversalPlatformAdapter } from "../../platform/adapters/universal";
import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";

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

  describe("PlatformAdapter", () => {
    it("should create NodePlatformAdapter for node environment", () => {
      const adapter = new PlatformAdapter("node");
      expect(adapter.env).toBe("node");
      expect((adapter as any).inner).toBeInstanceOf(NodePlatformAdapter);
    });

    it("should create BrowserPlatformAdapter for browser environment", () => {
      const adapter = new PlatformAdapter("browser");
      expect(adapter.env).toBe("browser");
      expect((adapter as any).inner).toBeInstanceOf(BrowserPlatformAdapter);
    });

    it("should create EdgePlatformAdapter for edge environment", () => {
      const adapter = new PlatformAdapter("edge");
      expect(adapter.env).toBe("edge");
      expect((adapter as any).inner).toBeInstanceOf(EdgePlatformAdapter);
    });

    it("should create GenericUniversalPlatformAdapter for universal environment", () => {
      const adapter = new PlatformAdapter("universal");
      expect(adapter.env).toBe("universal");
      expect((adapter as any).inner).toBeInstanceOf(GenericUniversalPlatformAdapter);
    });

    it("should create UniversalPlatformAdapter for unknown environment", () => {
      const adapter = new PlatformAdapter("unknown" as any);
      expect(adapter.env).toBe("unknown");
      expect((adapter as any).inner).toBeInstanceOf(UniversalPlatformAdapter);
    });

    it("should detect environment when no env is provided", () => {
      const adapter = new PlatformAdapter();
      expect(["node", "browser", "universal", "edge"]).toContain(adapter.env);
    });

    it("should delegate init to inner adapter", async () => {
      const adapter = new PlatformAdapter("node");
      const initSpy = jest.spyOn((adapter as any).inner, "init");
      
      await adapter.init();
      expect(initSpy).toHaveBeenCalled();
    });

    it("should delegate onUncaughtException to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn((adapter as any).inner, "onUncaughtException");
      
      adapter.onUncaughtException(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate onUnhandledRejection to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn((adapter as any).inner, "onUnhandledRejection");
      
      adapter.onUnhandledRejection(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate onShutdownSignal to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const handler = jest.fn();
      const spy = jest.spyOn((adapter as any).inner, "onShutdownSignal");
      
      adapter.onShutdownSignal(handler);
      expect(spy).toHaveBeenCalledWith(handler);
    });

    it("should delegate exit to inner adapter", () => {
      const adapter = new PlatformAdapter("browser"); // Use browser instead of node to avoid process.exit
      const spy = jest.spyOn((adapter as any).inner, "exit");
      
      try {
        adapter.exit(1);
      } catch {
        // May throw in some adapters
      }
      expect(spy).toHaveBeenCalledWith(1);
    });

    it("should delegate getEnv to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn((adapter as any).inner, "getEnv");
      
      adapter.getEnv("TEST_KEY");
      expect(spy).toHaveBeenCalledWith("TEST_KEY");
    });

    it("should delegate hasAsyncLocalStorage to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn((adapter as any).inner, "hasAsyncLocalStorage");
      
      adapter.hasAsyncLocalStorage();
      expect(spy).toHaveBeenCalled();
    });

    it("should delegate createAsyncLocalStorage to inner adapter", () => {
      const adapter = new PlatformAdapter("node");
      const spy = jest.spyOn((adapter as any).inner, "createAsyncLocalStorage");
      
      adapter.createAsyncLocalStorage();
      expect(spy).toHaveBeenCalled();
    });

    it("should use globalThis timeout methods", () => {
      const adapter = new PlatformAdapter("node");
      expect(adapter.setTimeout).toBe(globalThis.setTimeout);
      expect(adapter.clearTimeout).toBe(globalThis.clearTimeout);
    });
  });
});