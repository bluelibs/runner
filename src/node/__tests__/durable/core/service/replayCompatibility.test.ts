import { r, tags } from "../../../..";
import { DurableContext } from "../../../../durable/core/DurableContext";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import { replayWorkflow } from "../../../../durable/core/replay";
import { DurableOperator } from "../../../../durable/core/DurableOperator";
import type { DurableReplayFixture } from "../../../../durable/core/interfaces/history";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import type { DurableServiceConfig } from "../../../../durable/core/interfaces/service";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

const workflow = r
  .task("workflow")
  .run(async () => 1)
  .build();
async function replayFixture(): Promise<DurableReplayFixture> {
  const store = new MemoryStore();
  await store.saveExecution(
    pendingExecution({ id: "run", historyRecorded: true }),
  );
  const ctx = new DurableContext(store, new NoopEventBus(), "run", 1, {
    historyRecorded: true,
  });
  await ctx.step("parent", async () => ctx.step("nested", async () => 7));
  return new DurableOperator(store).exportReplay("run");
}
function executor(
  fn: (d: IDurableContext) => Promise<unknown>,
): DurableServiceConfig {
  let context!: IDurableContext;
  return {
    store: new MemoryStore(),
    taskExecutor: createTaskExecutor({ [workflow.id]: () => fn(context) }),
    contextProvider: (ctx, run) => {
      context = ctx;
      return run();
    },
  };
}

describe("replay compatibility boundaries", () => {
  it("skips completed nested effects and stops when new code exceeds the saved prefix", async () => {
    const fixture = await replayFixture();
    const effect = jest.fn(async () => 99);
    const report = await replayWorkflow(
      workflow,
      fixture,
      executor(async (d) => {
        expect(await d.step("parent", effect)).toBe(7);
        return d.step("new-tail", effect);
      }),
    );
    expect(report).toEqual({ compatible: true, matched: 1, issues: [] });
    expect(effect).not.toHaveBeenCalled();
  });

  it("rejects missing history and corrupt completed checkpoints without running effects", async () => {
    const fixture = await replayFixture();
    await expect(replayWorkflow(workflow, fixture, {})).rejects.toThrow(
      "task executor",
    );
    expect(
      (
        await replayWorkflow(
          workflow,
          {
            ...fixture,
            execution: { ...fixture.execution, historyRecorded: undefined },
          },
          executor(async () => 1),
        )
      ).compatible,
    ).toBe(false);
    expect(
      (
        await replayWorkflow(
          workflow,
          { ...fixture, history: [] },
          executor(async () => 1),
        )
      ).compatible,
    ).toBe(false);
    const report = await replayWorkflow(
      workflow,
      { ...fixture, steps: [] },
      executor(async (d) =>
        d.step("parent", async () => {
          throw new Error("must not run");
        }),
      ),
    );
    expect(report.compatible).toBe(false);
    expect(report.issues[0]).toContain("no reusable result");
  });

  it("checks operation kind and task identity, and reports unreached saved calls", async () => {
    const fixture = await replayFixture();
    const kind = structuredClone(fixture);
    kind.history[1].kind = "workflow";
    const identity = structuredClone(fixture);
    identity.history[1].taskKey = "different-task";
    for (const changed of [kind, identity]) {
      const report = await replayWorkflow(
        workflow,
        changed,
        executor(async (d) => d.step("parent", async () => 1)),
      );
      expect(report.compatible).toBe(false);
      expect(report.issues[0]).toContain("Expected");
    }
    expect(
      (
        await replayWorkflow(
          workflow,
          fixture,
          executor(async () => 1),
        )
      ).issues[0],
    ).toContain("not reached");
  });

  it("accepts a parked prefix without consulting live waits or invoking its unfinished callback", async () => {
    const fixture = await replayFixture();
    fixture.history = [
      fixture.history[0],
      { stepId: "__sleep:wait", kind: "sleep", startedOrder: 3 },
    ];
    fixture.steps = [];
    expect(
      await replayWorkflow(
        workflow,
        fixture,
        executor(async (d) => d.sleep(100, { stepId: "wait" })),
      ),
    ).toEqual({ compatible: true, matched: 1, issues: [] });
    fixture.history[1] = { stepId: "work", kind: "step", startedOrder: 3 };
    expect(
      (
        await replayWorkflow(
          workflow,
          fixture,
          executor(async (d) =>
            d.step("work", async () => {
              throw new Error("must not run");
            }),
          ),
        )
      ).compatible,
    ).toBe(true);
  });

  it("carries origin state and preserves task identities for completed child waits", async () => {
    const child = r
      .task("child")
      .tags([tags.durableWorkflow])
      .run(async () => 5)
      .build();
    const store = new MemoryStore();
    await store.saveExecution(
      pendingExecution({ id: "run", status: "running", historyRecorded: true }),
    );
    await store.saveWorkflowState({
      executionId: "run",
      state: { n: 7 },
      updatedAt: new Date(),
    });
    await store.saveExecution({
      ...pendingExecution({
        id: "child-run",
        workflowKey: "stable-child",
        status: "completed",
      }),
      result: 5,
    });
    const context = new DurableContext(store, new NoopEventBus(), "run", 1, {
      historyRecorded: true,
      getTaskPersistenceId: () => "stable-child",
      startWorkflowExecution: async () => "child-run",
    });
    expect(await context.workflow("spawn", child)).toBe("child-run");
    expect(await context.waitForExecution(child, "child-run")).toBe(5);
    const fixture = await new DurableOperator(store).exportReplay("run");
    const config = executor(async (d) => {
      const id = await d.workflow("spawn", child);
      return d.waitForExecution(child, id);
    });
    config.workflowKeyResolver = () => "stable-child";
    expect((await replayWorkflow(workflow, fixture, config)).compatible).toBe(
      true,
    );
    config.workflowKeyResolver = () => undefined;
    expect((await replayWorkflow(workflow, fixture, config)).compatible).toBe(
      false,
    );
  });

  it("reports orchestration errors and supports a standalone executor", async () => {
    const fixture = await replayFixture();
    for (const error of [new Error("broken code"), "broken code"]) {
      expect(
        (
          await replayWorkflow(
            workflow,
            fixture,
            executor(async () => {
              throw error;
            }),
          )
        ).issues[0],
      ).toBe("broken code");
    }
    const originOnly = { ...fixture, history: [fixture.history[0]], steps: [] };
    const config = executor(async () => 1);
    config.contextProvider = undefined;
    expect(
      (await replayWorkflow(workflow, originOnly, config)).compatible,
    ).toBe(true);
  });
});
