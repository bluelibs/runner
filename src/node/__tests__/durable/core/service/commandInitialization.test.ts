import { r, tags } from "../../../..";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("commands admitted before the first workflow attempt", () => {
  it("retains the wakeup without spinning when the pinned workflow version is unavailable", async () => {
    const store = new MemoryStore();
    const workflow = r
      .task("versioned")
      .tags([tags.durableWorkflow.with({ version: 2 })])
      .run(async () => 1)
      .build();
    const service = new DurableService({
      store,
      tasks: [workflow],
      timers: { enabled: false },
    });
    await store.saveExecution(
      pendingExecution({
        id: "queued",
        workflowKey: workflow.id,
        workflowVersion: 1,
      }),
    );
    await store.enqueueCommand({
      id: "request",
      executionId: "queued",
      requestedExecutionId: "queued",
      workflowVersion: 1,
      taskKey: "change",
      input: undefined,
      status: "pending",
      createdAt: new Date(),
    });
    try {
      await service.processExecution("queued");
      expect((await store.getExecution("queued"))?.status).toBe("pending");
      expect((await store.getNextCommand("queued"))?.status).toBe("pending");
      expect(
        (await store.getExecutionTimers("queued")).filter(
          (timer) => timer.commandWakeup,
        ),
      ).toHaveLength(1);
    } finally {
      await service.stop();
    }
  });

  it("lets workflow initialization checkpoint before applying queued changes", async () => {
    const store = new MemoryStore();
    const change = r
      .task("change")
      .run(async () => 1)
      .build();
    const workflow = r
      .task("workflow")
      .tags([tags.durableWorkflow.with({ commands: [change] })])
      .run(async () => 1)
      .build();
    let context!: IDurableContext;
    const service = new DurableService({
      store,
      tasks: [workflow],
      timers: { enabled: false },
      contextProvider: (ctx, run) => {
        context = ctx;
        return run();
      },
      taskExecutor: createTaskExecutor({
        [workflow.id]: async () => {
          await context.replaceState({ n: 0 });
          await context.sleep(10000);
          return true;
        },
        [change.id]: async () => {
          expect(await context.getState()).toEqual({ n: 0 });
          await context.setState({ n: 5 });
          return context.getState({ stepId: "updated" });
        },
      }),
    });
    try {
      await store.saveExecution(
        pendingExecution({ id: "queued", workflowKey: workflow.id }),
      );
      await store.enqueueCommand({
        id: "request",
        requestedExecutionId: "queued",
        executionId: "queued",
        taskKey: change.id,
        input: undefined,
        status: "pending",
        createdAt: new Date(),
      });
      await service.processExecution("queued");
      expect((await store.getCommand("request"))?.result).toEqual({ n: 5 });
      expect(await store.getWorkflowState("queued")).toMatchObject({
        state: { n: 5 },
      });
    } finally {
      await service.stop();
    }
  });
});
