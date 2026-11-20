import { DurableAuditEntryKind } from "../../../durable/core/audit";
import { encodeExecutionCursor } from "../../../durable/core/executionCursor";
import { ExecutionStatus } from "../../../durable/core/types";
import {
  contractT0,
  makeSqlExecution,
  type SqlContractFactory,
} from "./sqlStoreContract.exec.helpers";

export function registerSqlViewsContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: views, cursor pagination, steps, audit, and state`, () => {
    it("supports unfiltered/filtered queries, cursors, step tools, audit pagination, and state", async () => {
      const store = await factory.createStore({ namespace: "core-views" });
      try {
        const e1 = makeSqlExecution("e1", {
          status: ExecutionStatus.Completed,
          createdAt: new Date(contractT0.getTime() + 1_000),
        });
        const e2 = makeSqlExecution("e2", {
          workflowKey: "wf.beta",
          parentExecutionId: "e1",
          status: ExecutionStatus.Failed,
          createdAt: new Date(contractT0.getTime() + 1_000),
        });
        await store.saveExecution(e1);
        await store.saveExecution(e2);
        await store.saveExecution(makeSqlExecution("e3"));

        expect((await store.listExecutions()).length).toBe(3);
        expect((await store.listExecutionStates!({})).length).toBe(3);
        expect(
          (
            await store.listExecutions({
              status: [ExecutionStatus.Completed],
              workflowKey: "wf.alpha",
            })
          ).map((e) => e.id),
        ).toEqual(["e1"]);
        expect(
          (
            await store.listExecutions({
              parentExecutionId: "e1",
              offset: 0,
              limit: 1,
            })
          ).map((e) => e.id),
        ).toEqual(["e2"]);

        const cursor = encodeExecutionCursor({
          createdAt: new Date(contractT0.getTime() + 1_000).toISOString(),
          id: "e1",
        });
        expect(
          (await store.listExecutions({ cursor, offset: 5, limit: 10 })).map(
            (e) => e.id,
          ),
        ).toEqual(["e2", "e3"]);
        expect(
          (await store.listExecutionStates!({ cursor, limit: 10 })).map(
            (s) => s.id,
          ),
        ).toEqual(["e2", "e3"]);
        expect(await store.rebuildExecutionIndex!({})).toEqual({
          nextCursor: null,
        });
        expect(await store.rebuildExecutionIndex!({ limit: 5 })).toEqual({
          nextCursor: null,
        });
        await expect(
          store.rebuildExecutionIndex!({ limit: 0 }),
        ).rejects.toThrow();

        expect(await store.getStepResult("e1", "s1")).toBeNull();
        await store.saveStepResult({
          executionId: "e1",
          stepId: "s2",
          result: 2,
          completedAt: new Date(contractT0.getTime() + 20),
        });
        await store.skipStep!("e1", "s1");
        await store.editStepResult!("e1", "s1", { edited: true });
        expect((await store.getStepResult("e1", "s1"))?.result).toEqual({
          edited: true,
        });
        expect(
          (await store.listStepResults("e1")).map((s) => s.stepId),
        ).toEqual(["s2", "s1"]);

        await store.appendAuditEntry!({
          id: "a1",
          executionId: "e1",
          kind: DurableAuditEntryKind.ExecutionStatusChanged,
          at: contractT0,
          attempt: 1,
          from: null,
          to: ExecutionStatus.Pending,
        });
        await store.appendAuditEntry!({
          id: "a2",
          executionId: "e1",
          kind: DurableAuditEntryKind.ExecutionStatusChanged,
          at: contractT0,
          attempt: 1,
          from: ExecutionStatus.Pending,
          to: ExecutionStatus.Running,
        });
        expect((await store.listAuditEntries!("e1")).map((a) => a.id)).toEqual([
          "a1",
          "a2",
        ]);
        expect(
          (await store.listAuditEntries!("e1", { limit: 1 })).map((a) => a.id),
        ).toEqual(["a1"]);
        expect(
          (await store.listAuditEntries!("e1", { offset: 1 })).map((a) => a.id),
        ).toEqual(["a2"]);
        expect(
          (await store.listAuditEntries!("e1", { offset: 0, limit: 1 })).map(
            (a) => a.id,
          ),
        ).toEqual(["a1"]);

        expect(await store.getWorkflowState!("e1")).toBeNull();
        await store.saveWorkflowState!({
          executionId: "e1",
          state: { count: 1 },
          updatedAt: contractT0,
        });
        await store.saveWorkflowState!({
          executionId: "e1",
          state: { count: 2 },
          updatedAt: contractT0,
        });
        expect((await store.getWorkflowState!("e1"))?.state).toEqual({
          count: 2,
        });
      } finally {
        await store.dispose!();
      }
    });
  });
}
