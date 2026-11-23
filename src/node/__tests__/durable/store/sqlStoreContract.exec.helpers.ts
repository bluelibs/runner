import type { IDurableStore } from "../../../durable/core/interfaces/store";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";

export interface SqlContractFactory {
  createStore: (config?: {
    namespace?: string;
    autoCreateTables?: boolean;
  }) => Promise<IDurableStore>;
}

export const contractT0 = new Date("2025-01-01T00:00:00.000Z");

export function makeSqlExecution(
  id: string,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "wf.alpha",
    input: { value: id },
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: 3,
    createdAt: contractT0,
    updatedAt: contractT0,
    ...overrides,
  };
}

export function registerSqlExecContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: execution lifecycle & idempotency`, () => {
    it("enforces lifecycle init/dispose guards and namespace isolation", async () => {
      const manual = await factory.createStore({
        namespace: "ns-manual",
        autoCreateTables: false,
      });
      await expect(manual.getExecution("missing")).rejects.toThrow(
        /not initialized/i,
      );
      await Promise.all([manual.init!(), manual.init!()]);
      await manual.init!();
      await manual.saveExecution(makeSqlExecution("e-manual"));
      await manual.dispose!();
      await expect(manual.getExecution("e-manual")).rejects.toThrow(/dispose/i);
      await manual.init!();
      await manual.dispose!();

      const nsA = await factory.createStore({ namespace: "ns-a" });
      const nsB = await factory.createStore({ namespace: "ns-b" });
      try {
        await nsA.saveExecution(makeSqlExecution("shared-id"));
        expect(await nsA.getExecution("shared-id")).not.toBeNull();
        expect(await nsB.getExecution("shared-id")).toBeNull();
      } finally {
        await Promise.all([nsA.dispose!(), nsB.dispose!()]);
      }
    });

    it("handles CRUD, idempotency, CAS, incomplete/stuck lists, and operator transitions", async () => {
      const store = await factory.createStore({ namespace: "core-crud" });
      try {
        expect(await store.getExecution("ghost")).toBeNull();
        expect(await store.getExecutionState!("ghost")).toBeNull();
        await store.updateExecution("ghost", {
          status: ExecutionStatus.Failed,
        });
        await store.retryRollback!("ghost");
        await store.forceFail!("ghost", { message: "ignored" });

        const e1 = makeSqlExecution("e1", {
          workflowVersion: 1,
          createdAt: new Date(contractT0.getTime() + 1_000),
        });
        expect(
          await store.createExecutionWithIdempotencyKey({
            execution: e1,
            workflowKey: "wf.alpha",
            idempotencyKey: "k1",
          }),
        ).toEqual({ created: true, executionId: "e1" });
        expect(
          await store.createExecutionWithIdempotencyKey({
            execution: makeSqlExecution("e1-dup"),
            workflowKey: "wf.alpha",
            idempotencyKey: "k1",
          }),
        ).toEqual({ created: false, executionId: "e1" });

        await store.updateExecution("e1", { status: ExecutionStatus.Running });
        expect((await store.getExecution("e1"))?.status).toBe(
          ExecutionStatus.Running,
        );
        expect((await store.getExecutionState!("e1"))?.status).toBe(
          ExecutionStatus.Running,
        );

        await store.enqueueCommand!({
          id: "c-cas",
          requestedExecutionId: "e1",
          executionId: "e1",
          taskKey: "t",
          workflowVersion: 1,
          input: 1,
          status: "pending",
          createdAt: contractT0,
        });
        expect(
          await store.saveExecutionIfStatus(
            {
              ...e1,
              status: ExecutionStatus.Completed,
              completedAt: contractT0,
            },
            [ExecutionStatus.Running],
          ),
        ).toBe(false);
        await store.completeCommand!(
          {
            id: "c-cas",
            requestedExecutionId: "e1",
            executionId: "e1",
            taskKey: "t",
            workflowVersion: 1,
            input: 1,
            status: "failed",
            createdAt: contractT0,
            completedAt: contractT0,
          },
          undefined,
        );
        expect(
          await store.saveExecutionIfStatus(
            { ...e1, status: ExecutionStatus.Running },
            [ExecutionStatus.Pending],
          ),
        ).toBe(false);
        expect(
          await store.saveExecutionIfStatus(
            {
              ...e1,
              status: ExecutionStatus.Completed,
              completedAt: contractT0,
            },
            [ExecutionStatus.Running],
          ),
        ).toBe(true);
        await store.saveExecution(
          makeSqlExecution("e-cont-cas", { status: ExecutionStatus.Running }),
        );
        expect(
          await store.saveExecutionIfStatus(
            makeSqlExecution("e-cont-cas", {
              status: ExecutionStatus.ContinuedAsNew,
              completedAt: contractT0,
            }),
            [ExecutionStatus.Running],
          ),
        ).toBe(true);

        const e2 = makeSqlExecution("e2", {
          workflowKey: "wf.beta",
          parentExecutionId: "e1",
          status: ExecutionStatus.CompensationFailed,
          createdAt: new Date(contractT0.getTime() + 1_000),
        });
        await store.saveExecution(e2);
        await store.saveExecution(makeSqlExecution("e3"));

        expect(
          (await store.listIncompleteExecutions()).map((e) => e.id),
        ).toEqual(["e3"]);
        expect((await store.listStuckExecutions!()).map((e) => e.id)).toEqual([
          "e2",
        ]);
        await store.retryRollback!("e2");
        expect((await store.getExecution("e2"))?.status).toBe(
          ExecutionStatus.Pending,
        );
        await store.forceFail!("e2", { message: "boom" });
        expect((await store.getExecution("e2"))?.status).toBe(
          ExecutionStatus.Failed,
        );
      } finally {
        await store.dispose!();
      }
    });
  });
}
