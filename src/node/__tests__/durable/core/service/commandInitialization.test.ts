import { r, tags } from "../../../..";
import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import { DurableService } from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("commands admitted before the first workflow attempt", () => {
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
          await context.setState({ n: 5 });
          return context.getState();
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
      expect(await store.getWorkflowState("queued")).toMatchObject({
        state: { n: 0 },
      });
      expect((await store.getCommand("request"))?.status).toBe("pending");
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
