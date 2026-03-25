import { r, run } from "@bluelibs/runner";

import { appConfig, type AskRunnerConfig } from "../app/config/app-config.resource";

describe("ask-runner app config", () => {
  const envKeys = [
    "OPENAI_API_KEY",
    "ASK_RUNNER_ADMIN_SECRET",
    "ASK_RUNNER_TRUST_PROXY",
  ] as const;

  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  async function loadConfig(): Promise<AskRunnerConfig> {
    const reader = r
      .resource("configReader")
      .dependencies({ appConfig })
      .init(async (_config, deps) => deps.appConfig)
      .build();

    const root = r.resource("root").register([appConfig, reader]).build();
    const runtime = await run(root);

    try {
      return runtime.getResourceValue(reader);
    } finally {
      await runtime.dispose();
    }
  }

  test("defaults trustProxy to true when the env var is unset", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ASK_RUNNER_ADMIN_SECRET = "test-secret";

    const config = await loadConfig();

    expect(config.trustProxy).toBe(true);
  });

  test("allows explicitly disabling trustProxy with the env var", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ASK_RUNNER_ADMIN_SECRET = "test-secret";
    process.env.ASK_RUNNER_TRUST_PROXY = "false";

    const config = await loadConfig();

    expect(config.trustProxy).toBe(false);
  });
});
