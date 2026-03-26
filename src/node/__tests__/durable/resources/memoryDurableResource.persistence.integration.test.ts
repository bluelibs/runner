import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r, resources, run, tags } from "../../../node";
import { ExecutionStatus } from "../../../durable/core/types";
import { waitUntil } from "../../../durable/test-utils";

function buildPersistedMemoryApp(filePath: string) {
  const durable = resources.memoryWorkflow.fork(
    "durable-tests-memory-persist-resource",
  );

  const task = r
    .task("durable-tests-memory-persist-task")
    .dependencies({ durable })
    .tags([
      tags.durableWorkflow.with({
        key: "durable-tests.memory.persist",
      }),
    ])
    .run(async (_input: undefined, { durable }) => {
      const ctx = durable.use();
      const before = await ctx.step("before", async () => "before");
      await ctx.sleep(100, { stepId: "nap" });
      const after = await ctx.step("after", async () => "after");
      return { before, after };
    })
    .build();

  const app = r
    .resource("durable-tests-memory-persist-app")
    .register([
      resources.durable,
      durable.with({
        persist: { filePath },
        polling: { interval: 5 },
        recovery: { onStartup: true },
      }),
      task,
    ])
    .build();

  return { app, durable, task } as const;
}

describe("durable: memoryDurableResource persistence (integration)", () => {
  let tempDirectory: string;
  let filePath: string;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "runner-memory-workflow-"));
    filePath = join(tempDirectory, "durable-memory.json");
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it("resumes a sleeping execution after restart when persist.filePath is configured", async () => {
    const firstRuntimeShape = buildPersistedMemoryApp(filePath);
    const firstRuntime = await run(firstRuntimeShape.app, {
      logs: { printThreshold: null },
    });

    const firstDurable = firstRuntime.getResourceValue(
      firstRuntimeShape.durable,
    );
    const executionId = await firstDurable.start(firstRuntimeShape.task);

    await waitUntil(
      async () => {
        const detail =
          await firstDurable.operator.getExecutionDetail(executionId);
        return detail.execution?.status === ExecutionStatus.Sleeping;
      },
      { timeoutMs: 2_000, intervalMs: 5 },
    );

    await firstRuntime.dispose();

    const secondRuntimeShape = buildPersistedMemoryApp(filePath);
    const secondRuntime = await run(secondRuntimeShape.app, {
      logs: { printThreshold: null },
    });
    const secondDurable = secondRuntime.getResourceValue(
      secondRuntimeShape.durable,
    );

    try {
      await expect(
        secondDurable.wait(executionId, {
          timeout: 5_000,
          waitPollIntervalMs: 5,
        }),
      ).resolves.toEqual({
        before: "before",
        after: "after",
      });
    } finally {
      await secondRuntime.dispose();
    }
  });
});
