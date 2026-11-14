import type { IDurableContext } from "../../../../durable/core/interfaces/context";
import {
  DurableService,
  initDurableService,
} from "../../../../durable/core/DurableService";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  okTask,
  pendingExecution,
  SpyQueue,
} from "../../helpers/DurableService.unit.helpers";

class LeaseTestStore extends MemoryStore {
  expire(id: string): void {
    this.locks.get(`execution:${id}`)!.expires = 0;
  }
}

describe("durable cluster takeover", () => {
  it("recovers without restarting, replays checkpoints, and rejects a late old worker", async () => {
    jest.useFakeTimers();
    const store = new LeaseTestStore();
    const task = okTask("cluster-workflow");
    let resumeOld!: () => void;
    let entered!: () => void;
    const enteredStep = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const oldResult = new Promise<void>((resolve) => {
      resumeOld = resolve;
    });
    let checkpoints = 0;
    const contexts: IDurableContext[] = [];
    const worker = (name: string) =>
      new DurableService({
        store,
        tasks: [task],
        polling: { enabled: false },
        recovery: { enabled: name === "new", intervalMs: 100 },
        contextProvider: async (context, fn) => {
          contexts.push(context);
          return fn();
        },
        taskExecutor: {
          run: async (): Promise<any> => {
            const context = contexts[contexts.length - 1]!;
            await context.step("checkpoint", async () => {
              checkpoints++;
              return "saved";
            });
            return context.step("effect", async () => {
              if (name === "old") {
                entered();
                await oldResult;
              }
              await context._getStore().saveWorkflowState!({
                executionId: "one",
                state: name,
                updatedAt: new Date(),
              });
              return name;
            });
          },
        },
      });
    const old = worker("old");
    const replacement = worker("new");
    try {
      await store.saveExecution(
        pendingExecution({ id: "one", workflowKey: task.id }),
      );
      const original = old.processExecution("one");
      await enteredStep;
      store.expire("one");
      replacement.startHistoryCollection();
      await jest.advanceTimersByTimeAsync(100);
      expect(await store.getExecution("one")).toMatchObject({
        status: "completed",
        result: "new",
        attempt: 1,
      });
      resumeOld();
      await original;
      expect(await store.getStepResult("one", "effect")).toMatchObject({
        result: "new",
      });
      expect(await store.getExecution("one")).toMatchObject({
        status: "completed",
        result: "new",
        attempt: 1,
      });
      expect(checkpoints).toBe(1);
      expect((await store.getWorkflowState("one"))?.state).toBe("new");
      expect(await store.getExecutionTimers("one")).toEqual([]);
    } finally {
      resumeOld();
      await Promise.all([old.stop(), replacement.stop()]);
      jest.useRealTimers();
    }
  });

  it("starts during initialization even with polling disabled and stops at cooldown", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const task = okTask("cluster-init");
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: task.id }),
    );
    const service = await initDurableService({
      store,
      queue,
      tasks: [task],
      polling: { enabled: false },
      recovery: { enabled: true, intervalMs: 100 },
    });
    try {
      await jest.advanceTimersByTimeAsync(100);
      expect(queue.enqueued).toHaveLength(1);
      await service.cooldown();
      await store.saveExecution(
        pendingExecution({ id: "two", workflowKey: task.id }),
      );
      await jest.advanceTimersByTimeAsync(300);
      expect(queue.enqueued).toHaveLength(1);
    } finally {
      await service.stop();
      jest.useRealTimers();
    }
  });
});
