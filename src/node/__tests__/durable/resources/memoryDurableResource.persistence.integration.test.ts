import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r, resources, run, tags } from "../../../node";
import { ExecutionStatus } from "../../../durable/core/types";
import { waitUntil } from "../../../durable/test-utils";

type PersistedWorkflowControl = {
  beforeRuns: number;
  afterRuns: number;
};

function buildPersistedMemoryApp(
  filePath: string,
  control?: PersistedWorkflowControl,
) {
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
      const before = await ctx.step("before", async () => {
        control && (control.beforeRuns += 1);
        return "before";
      });
      await ctx.sleep(100, { stepId: "nap" });
      const after = await ctx.step("after", async ({ signal }) => {
        control && (control.afterRuns += 1);

        if (control && control.afterRuns === 1) {
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new Error("Interrupted by durable shutdown");
        }

        return "after";
      });
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

  it("resumes an interrupted in-flight step after restart when shutdown enters the abort window", async () => {
    const control: PersistedWorkflowControl = {
      beforeRuns: 0,
      afterRuns: 0,
    };
    const firstRuntimeShape = buildPersistedMemoryApp(filePath, control);
    const firstRuntime = await run(firstRuntimeShape.app, {
      logs: { printThreshold: null },
      dispose: {
        totalBudgetMs: 2_000,
        drainingBudgetMs: 0,
        abortWindowMs: 100,
        cooldownWindowMs: 0,
      },
    });

    const firstDurable = firstRuntime.getResourceValue(
      firstRuntimeShape.durable,
    );
    const executionId = await firstDurable.start(firstRuntimeShape.task);

    await waitUntil(
      async () => {
        const detail =
          await firstDurable.operator.getExecutionDetail(executionId);
        return (
          detail.execution?.status === ExecutionStatus.Running &&
          detail.execution.current?.kind === "step" &&
          detail.execution.current.stepId === "after"
        );
      },
      { timeoutMs: 2_000, intervalMs: 5 },
    );

    await firstRuntime.dispose();

    expect(control.beforeRuns).toBe(1);
    expect(control.afterRuns).toBe(1);

    const secondRuntimeShape = buildPersistedMemoryApp(filePath, control);
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

      expect(control.beforeRuns).toBe(1);
      expect(control.afterRuns).toBe(2);
    } finally {
      await secondRuntime.dispose();
    }
  });
});
