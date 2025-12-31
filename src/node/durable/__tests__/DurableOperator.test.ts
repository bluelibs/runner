import { DurableOperator } from "../core/DurableOperator";
import type { IDurableStore } from "../core/interfaces/store";
import { MemoryStore } from "../store/MemoryStore";
import type { DurableAuditEntry } from "../core/audit";

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

  it("lists executions via listExecutions when supported and falls back otherwise", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const executions = await operator.listExecutions({ taskId: "t" });
    expect(executions.map((e) => e.id)).toEqual(["e1"]);

    const fallbackStore: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [
        {
          id: "e2",
          taskId: "t",
          input: undefined,
          status: "pending",
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
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

    const fallbackOperator = new DurableOperator(fallbackStore);
    const fallback = await fallbackOperator.listExecutions();
    expect(fallback.map((e) => e.id)).toEqual(["e2"]);
  });

  it("returns execution detail with steps and audit entries when available", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "s1",
      result: "ok",
      completedAt: new Date(),
    });

    const auditEntry: DurableAuditEntry = {
      id: "1:x",
      executionId: "e1",
      at: new Date(),
      attempt: 1,
      kind: "note",
      message: "hello",
    };
    await store.appendAuditEntry(auditEntry);

    const detail = await operator.getExecutionDetail("e1");
    expect(detail.execution?.id).toBe("e1");
    expect(detail.steps.map((s) => s.stepId)).toEqual(["s1"]);
    expect(detail.audit.some((a) => a.kind === "note")).toBe(true);
  });

  it("returns empty arrays for missing step/audit listing support", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e1",
        taskId: "t",
        input: undefined,
        status: "pending",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
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
    const detail = await operator.getExecutionDetail("e1");
    expect(detail.execution?.id).toBe("e1");
    expect(detail.steps).toEqual([]);
    expect(detail.audit).toEqual([]);
  });
});
