import { env, getNodeEnv } from "./env.resource";
import { buildTestRunner } from "../../test/utils";

describe("env resource", () => {
  const orig = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = orig;
  });

  it("getNodeEnv returns default when unset", () => {
    delete (process.env as any).NODE_ENV;
    expect(getNodeEnv()).toBe("development");
  });

  it("reads NODE_ENV and merges defaults", async () => {
    process.env.NODE_ENV = "test";
    const rr = await buildTestRunner({ register: [] });
    try {
      const e = rr.getResourceValue(env);
      expect(e.NODE_ENV).toBe("test");
      expect(e.PORT).toBeDefined();
    } finally {
      await rr.dispose();
    }
  });
});
