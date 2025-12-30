import { DurableOperator } from "../core/DurableOperator";
import type { IDurableStore } from "../core/interfaces/store";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableOperator", () => {
  it("delegates to store operator APIs", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await operator.retryRollback("e1");
    expect((await store.getExecution("e1"))?.status).toBe("pending");

    await operator.skipStep("e1", "s1");
    expect((await store.getStepResult("e1", "s1"))?.result).toEqual({
      skipped: true,
      manual: true,
    });

    await operator.editState("e1", "s2", { ok: true });
    expect((await store.getStepResult("e1", "s2"))?.result).toEqual({
      ok: true,
    });

    await operator.forceFail("e1", "manual");
    expect((await store.getExecution("e1"))?.status).toBe("failed");
  });

  it("lists stuck executions when supported", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const operator = new DurableOperator(store);
    const stuck = await operator.listStuckExecutions();
    expect(stuck.map((e) => e.id)).toEqual(["e1"]);
  });

  it("throws helpful errors when store does not support an operator action", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const operator = new DurableOperator(store);

    await expect(operator.retryRollback("e1")).rejects.toThrow("retryRollback");
    await expect(operator.skipStep("e1", "s1")).rejects.toThrow("skipStep");
    await expect(operator.forceFail("e1", "x")).rejects.toThrow("forceFail");
    await expect(operator.editState("e1", "s1", 1)).rejects.toThrow(
      "editStepResult",
    );
    await expect(operator.listStuckExecutions()).rejects.toThrow(
      "listStuckExecutions",
    );
  });
});
