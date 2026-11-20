import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
} from "../../../durable/core/types";
import {
  contractT0,
  makeSqlExecution,
  type SqlContractFactory,
} from "./sqlStoreContract.exec.helpers";

export function registerSqlRetentionContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: history, checkpoints, and retention`, () => {
    it("handles ordered history, checkpoint branching, and two-stage receipt retention", async () => {
      const store = await factory.createStore({ namespace: "core-retention" });
      try {
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s1",
          phase: "started",
        });
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s1",
          phase: "started",
        });
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s1",
          phase: "completed",
          stateAfter: { value: 9 },
        });
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s1",
          phase: "completed",
        });
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s2",
          phase: "started",
        });
        await store.recordExecutionHistory!("h1", {
          kind: "step",
          stepId: "s2",
          phase: "completed",
        });
        const history = await store.listExecutionHistory!("h1");
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
          startedOrder: 1,
          completedOrder: 2,
          stateAfter: { value: 9 },
        });

        const src = makeSqlExecution("src", {
          status: ExecutionStatus.Completed,
          completedAt: contractT0,
        });
        await store.saveExecution(src);
        expect(
          await store.createCheckpointExecution!({
            expected: makeSqlExecution("src"),
            execution: makeSqlExecution("branch-fail"),
            steps: [],
            history: [],
            state: null,
          }),
        ).toBe(false);
        expect(
          await store.createCheckpointExecution!({
            expected: src,
            execution: makeSqlExecution("src"),
            steps: [],
            history: [],
            state: null,
          }),
        ).toBe(false);
        expect(
          await store.createCheckpointExecution!({
            expected: src,
            execution: makeSqlExecution("branch-ok"),
            steps: [
              {
                executionId: "branch-ok",
                stepId: "s1",
                result: 1,
                completedAt: contractT0,
              },
            ],
            history: [
              {
                kind: "step",
                stepId: "s1",
                startedOrder: 1,
                completedOrder: 2,
              },
            ],
            state: { value: { count: 3 } },
          }),
        ).toBe(true);
        expect(
          await store.createCheckpointExecution!({
            expected: src,
            execution: makeSqlExecution("branch-no-state"),
            steps: [],
            history: [{ kind: "step", stepId: "s1", startedOrder: 1 }],
            state: null,
          }),
        ).toBe(true);
        expect((await store.getWorkflowState!("branch-ok"))?.state).toEqual({
          count: 3,
        });

        const policy = {
          onComplete: { afterMs: 1_000 },
          receipts: { afterMs: 5_000 },
        } as const;
        await store.saveExecution(
          makeSqlExecution("p-run", {
            status: ExecutionStatus.Running,
            completedAt: contractT0,
            retention: { onComplete: "retain" },
          }),
        );
        await store.saveExecution(
          makeSqlExecution("child-wait", {
            parentExecutionId: "p-run",
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: policy,
          }),
        );
        await store.saveExecution(
          makeSqlExecution("locked-r", {
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: policy,
          }),
        );
        const lockToken = await store.acquireLock!(
          "execution:locked-r",
          60_000,
        );
        await store.saveExecution(
          makeSqlExecution("waited-r", {
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: policy,
          }),
        );
        await store.upsertExecutionWaiter({
          targetExecutionId: "waited-r",
          executionId: "p-run",
          stepId: "w-step",
        });
        await store.saveExecution(
          makeSqlExecution("cmd-blocked", {
            status: ExecutionStatus.Running,
            workflowVersion: 1,
            retention: policy,
          }),
        );
        await store.enqueueCommand!({
          id: "cmd-b",
          requestedExecutionId: "cmd-blocked",
          executionId: "cmd-blocked",
          taskKey: "t",
          workflowVersion: 1,
          input: 1,
          status: "pending",
          createdAt: contractT0,
        });
        await store.saveExecution(
          makeSqlExecution("cmd-blocked", {
            status: ExecutionStatus.Completed,
            workflowVersion: 1,
            completedAt: contractT0,
            retention: policy,
          }),
        );
        await store.saveExecution(
          makeSqlExecution("stale-both", {
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: policy,
          }),
        );
        const internals = store as unknown as {
          runtime: {
            namespace: string;
            stringify: (v: unknown) => string;
            backend: {
              run: (
                sql: string,
                p: readonly (string | number | null)[],
              ) => Promise<void>;
            };
          };
        };
        await internals.runtime.backend.run(
          `UPDATE runner_durable_executions SET payload = ? WHERE namespace = ? AND id = ?`,
          [
            internals.runtime.stringify(
              makeSqlExecution("stale-both", {
                status: ExecutionStatus.Completed,
                completedAt: contractT0,
                retention: { onComplete: "retain" },
              }),
            ),
            internals.runtime.namespace,
            "stale-both",
          ],
        );

        await store.createExecutionWithIdempotencyKey({
          execution: makeSqlExecution("due-1", {
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: policy,
          }),
          workflowKey: "wf.alpha",
          idempotencyKey: "k-due",
        });
        await store.saveStepResult({
          executionId: "due-1",
          stepId: "st",
          result: 1,
          completedAt: contractT0,
        });
        await store.createTimer({
          id: "t-due",
          executionId: "due-1",
          type: TimerType.Sleep,
          fireAt: contractT0,
          status: TimerStatus.Pending,
        });
        await store.claimTimer!("t-due", "w1", 60_000);

        const tHist = new Date(contractT0.getTime() + 1_500);
        expect(await store.collectCompletedHistory!(tHist, 1)).toBe(1);
        expect(await store.collectCompletedHistory!(tHist, 10)).toBe(1);
        expect(await store.listStepResults("due-1")).toEqual([]);
        expect(await store.getExecution("due-1")).not.toBeNull();

        await store.saveExecution(
          makeSqlExecution("p-run", {
            status: ExecutionStatus.Completed,
            completedAt: contractT0,
            retention: { onComplete: "retain" },
          }),
        );
        await store.releaseLock!("execution:locked-r", lockToken!);
        await store.deleteExecutionWaiter("waited-r", "p-run", "w-step");

        const tRec = new Date(contractT0.getTime() + 5_000);
        expect(await store.collectExpiredReceipts!(tRec, 1)).toBe(1);
        expect(await store.collectExpiredReceipts!(tRec, 10)).toBe(3);
        expect(await store.getExecution("due-1")).toBeNull();
        expect(await store.getExecution("cmd-blocked")).not.toBeNull();
        expect(
          await store.createExecutionWithIdempotencyKey({
            execution: makeSqlExecution("due-reused"),
            workflowKey: "wf.alpha",
            idempotencyKey: "k-due",
          }),
        ).toEqual({ created: true, executionId: "due-reused" });
      } finally {
        await store.dispose!();
      }
    });
  });
}
