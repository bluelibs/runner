import { DurableOperator } from "../../durable/core/DurableOperator";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createBareStore } from "./DurableService.unit.helpers";

describe("durable: DurableOperator", () => {
  it("delegates to store operator APIs", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
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
      workflowKey: "t",
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
    const store: IDurableStore = createBareStore(new MemoryStore());

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

  it("lists executions via the required store query API", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const executions = await operator.listExecutions({ workflowKey: "t" });
    expect(executions.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns raw execution detail including steps and audit trail", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);

    await store.saveExecution({
      id: "e-detail",
      workflowKey: "orders",
      input: { orderId: "o1" },
      status: "completed",
      result: { ok: true },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e-detail",
      stepId: "step-1",
      result: { child: "done" },
      completedAt: new Date(),
    });
    await store.appendAuditEntry?.({
      id: "audit-1",
      kind: "note",
      executionId: "e-detail",
      attempt: 1,
      at: new Date(),
      message: "hello detail",
    });

    await expect(operator.getExecutionDetail("e-detail")).resolves.toEqual({
      execution: expect.objectContaining({
        id: "e-detail",
        workflowKey: "orders",
      }),
      steps: [expect.objectContaining({ stepId: "step-1" })],
      audit: [
        expect.objectContaining({ kind: "note", message: "hello detail" }),
      ],
    });
  });
});
