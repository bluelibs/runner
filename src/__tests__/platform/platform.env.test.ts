import { readEnvironmentVariable } from "../../platform/adapters/env";

interface EnvTestGlobal {
  __ENV__?: Record<string, string | undefined> | null;
  env?: Record<string, string | undefined> | null;
  process?: { env?: Record<string, string | undefined> };
  Bun?: { env?: Record<string, string | undefined> };
  Deno?: {
    env?: {
      get?: (key: string) => string | undefined;
    };
  };
}

const testGlobal = globalThis as unknown as EnvTestGlobal;

describe("platform env reader", () => {
  const originalEnv = testGlobal.__ENV__;
  const originalGlobalEnv = testGlobal.env;
  const originalProcess = testGlobal.process;
  const originalBun = testGlobal.Bun;
  const originalDeno = testGlobal.Deno;

  afterEach(() => {
    testGlobal.__ENV__ = originalEnv;
    testGlobal.env = originalGlobalEnv;
    testGlobal.process = originalProcess;
    testGlobal.Bun = originalBun;
    testGlobal.Deno = originalDeno;
  });

  it("falls back when Deno.env.get returns undefined", () => {
    testGlobal.__ENV__ = null;
    testGlobal.Deno = {
      env: {
        get: () => undefined,
      },
    };
    testGlobal.Bun = { env: { TEST_KEY: "bun-value" } };

    expect(readEnvironmentVariable("TEST_KEY")).toBe("bun-value");
  });

  it("calls Deno.env.get with Deno.env as the receiver", () => {
    testGlobal.__ENV__ = null;

    const denoEnv = {
      prefix: "from-deno",
      get(this: { prefix: string }, key: string) {
        return `${this.prefix}:${key}`;
      },
    };

    testGlobal.Deno = { env: denoEnv };

    expect(readEnvironmentVariable("TEST_KEY")).toBe("from-deno:TEST_KEY");
  });

  it("returns undefined when every known env source is missing", () => {
    testGlobal.__ENV__ = null;
    testGlobal.Deno = { env: {} };
    testGlobal.Bun = { env: undefined };
    testGlobal.process = { env: undefined };
    testGlobal.env = null;

    expect(readEnvironmentVariable("TEST_KEY")).toBeUndefined();
  });
});
