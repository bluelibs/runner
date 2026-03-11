import { defineResource } from "../../define";
import { RunResult } from "../../models";
import { createTestFixture } from "../test-utils";
import { ResourceLifecycleMode, RunnerMode } from "../../types/runner";

enum ResourceId {
  Root = "store-regression-root",
}

describe("Store regressions", () => {
  it("fails fast when taskRunner is missing during initialization", () => {
    const { store, logger, eventManager, createTaskRunner } =
      createTestFixture();
    const runtimeResult = new RunResult<unknown>(
      logger,
      store,
      eventManager,
      createTaskRunner(),
      {
        logs: {
          printThreshold: "info",
          printStrategy: "pretty",
          bufferLogs: false,
        },
        errorBoundary: true,
        shutdownHooks: false,
        dispose: {
          totalBudgetMs: 30_000,
          drainingBudgetMs: 20_000,
          cooldownWindowMs: 0,
        },
        onUnhandledError: async () => {},
        dryRun: false,
        executionContext: null,
        lazy: false,
        lifecycleMode: ResourceLifecycleMode.Sequential,
        mode: RunnerMode.TEST,
      },
      async () => store.dispose(),
    );
    const root = defineResource({
      id: ResourceId.Root,
      init: async () => "root",
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /TaskRunner is not set/i,
    );
  });
});
