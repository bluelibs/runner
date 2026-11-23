import { MemoryStore } from "../../../durable/store/MemoryStore";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";
import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";

const request = (id: string): DurableCommandRecord => ({
  id,
  executionId: "exact/id:a",
  requestedExecutionId: "exact/id:a",
  taskKey: "change",
  input: undefined,
  status: "pending",
  createdAt: new Date(0),
});

describe("command wakeup persistence", () => {
  it("admits duplicate callers with one receipt and one durable wakeup, without postponing it", async () => {
    const store = new MemoryStore();
    await store.saveExecution(pendingExecution({ id: "exact/id:a" }));
    await store.enqueueCommand(request("one"));
    const timers = await store.getExecutionTimers("exact/id:a");
    await Promise.all(
      Array.from({ length: 10 }, () => store.enqueueCommand(request("one"))),
    );
    await store.enqueueCommand(request("two"));
    expect(await store.getExecutionTimers("exact/id:a")).toEqual(timers);
    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({ type: "retry", commandWakeup: true });
    const restored = new MemoryStore();
    restored.restoreSnapshot(store.exportSnapshot());
    expect(await restored.getExecutionTimers("exact/id:a")).toEqual(timers);
    expect((await restored.getNextCommand("exact/id:a"))?.id).toBe("one");
    await restored.completeCommand({ ...request("one"), status: "failed" });
    expect(await restored.getExecutionTimers("exact/id:a")).toEqual(timers);
    await restored.completeCommand({ ...request("two"), status: "failed" });
    expect(await restored.getExecutionTimers("exact/id:a")).toEqual([]);
  });

  it("retains a new admission when an older timer delivery releases its claim", async () => {
    const store = new MemoryStore();
    await store.saveExecution(pendingExecution({ id: "exact/id:a" }));
    await store.enqueueCommand(request("one"));
    const [timer] = await store.getExecutionTimers("exact/id:a");
    expect(await store.claimTimer(timer.id, "worker", 30000)).toBe(true);
    const deadline = new Date(5000);
    expect(await store.rescheduleCommandTimer("exact/id:a", deadline)).toBe(
      true,
    );
    deadline.setTime(0);
    expect((await store.getExecutionTimers("exact/id:a"))[0].fireAt).toEqual(
      new Date(5000),
    );
    await store.completeCommand({ ...request("one"), status: "failed" });
    await store.enqueueCommand(request("two"));
    expect(await store.releaseTimerClaim(timer.id, "worker")).toBe(true);
    expect(await store.getExecutionTimers("exact/id:a")).toEqual([
      expect.objectContaining({ id: timer.id }),
    ]);
    expect(await store.claimTimer(timer.id, "other", 30000)).toBe(true);
    await store.releaseTimerClaim(timer.id, "other");
    await store.completeCommand({ ...request("two"), status: "failed" });
    await store.createTimer(timer);
    expect(
      await store.rescheduleCommandTimer("exact/id:a", new Date(6000)),
    ).toBe(false);
    expect(
      await store.rescheduleCommandTimer("exact/id:a", new Date(6000)),
    ).toBe(false);
    expect(await store.getExecutionTimers("exact/id:a")).toEqual([]);
  });

  it.each([undefined, null, { value: undefined }])(
    "distinguishes an uninitialized state from initialized state %p",
    async (state) => {
      const store = new MemoryStore();
      const execution = pendingExecution({ id: "exact/id:a" });
      await store.saveExecution(execution);
      await store.saveWorkflowState({
        executionId: execution.id,
        state: 7,
        updatedAt: new Date(),
      });
      await store.enqueueCommand(request("one"));
      expect(
        await store.completeCommand(
          {
            ...request("one"),
            status: "completed",
            state,
            completedAt: new Date(),
          },
          execution,
        ),
      ).toBe(true);
      const saved = await store.getWorkflowState(execution.id);
      if (state === undefined) expect(saved?.state).toBe(7);
      else if (state === null) expect(saved).toBeNull();
      else expect(saved).toEqual(expect.objectContaining({ state: undefined }));
    },
  );
});
