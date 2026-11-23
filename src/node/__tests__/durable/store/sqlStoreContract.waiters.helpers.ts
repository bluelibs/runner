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

export function registerSqlWaitersContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: signal waiters, continuation, and execution waiters`, () => {
    it("handles signal waiters, continuation transfer, and execution waiters", async () => {
      const store = await factory.createStore({ namespace: "coord-waiters" });
      try {
        expect(await store.peekNextSignalWaiter("e1", "sig-a")).toBeNull();
        expect(await store.takeNextSignalWaiter("e1", "sig-a")).toBeNull();
        await store.upsertSignalWaiter({
          executionId: "e1",
          signalId: "sig-a",
          stepId: "w2",
          sortKey: "002",
        });
        await store.upsertSignalWaiter({
          executionId: "e1",
          signalId: "sig-a",
          stepId: "w1",
          sortKey: "001",
        });
        expect((await store.peekNextSignalWaiter("e1", "sig-a"))?.stepId).toBe(
          "w1",
        );
        expect((await store.takeNextSignalWaiter("e1", "sig-a"))?.stepId).toBe(
          "w1",
        );
        await store.deleteSignalWaiter("e1", "sig-a", "w2");

        const liveStep = {
          executionId: "e1",
          stepId: "w-live",
          result: { state: "completed", payload: 1 },
          completedAt: contractT0,
        };
        const liveSig = { id: "sr1", payload: 1, receivedAt: contractT0 };
        expect(
          await store.commitSignalDelivery!({
            executionId: "e1",
            signalId: "s-live",
            stepId: "w-live",
            stepResult: liveStep,
            signalRecord: liveSig,
          }),
        ).toBe(false);
        await store.saveStepResult({
          executionId: "e1",
          stepId: "w-live",
          result: { state: "completed" },
          completedAt: contractT0,
        });
        expect(
          await store.commitSignalDelivery!({
            executionId: "e1",
            signalId: "s-live",
            stepId: "w-live",
            stepResult: liveStep,
            signalRecord: liveSig,
          }),
        ).toBe(false);
        await store.saveStepResult({
          executionId: "e1",
          stepId: "w-live",
          result: { state: "waiting", signalId: "s-live" },
          completedAt: contractT0,
        });
        expect(
          await store.commitSignalDelivery!({
            executionId: "e1",
            signalId: "s-live",
            stepId: "w-live",
            stepResult: liveStep,
            signalRecord: liveSig,
          }),
        ).toBe(false);
        await store.upsertSignalWaiter({
          executionId: "e1",
          signalId: "s-live",
          stepId: "w-live",
          sortKey: "001",
        });
        await store.createTimer({
          id: "wt-1",
          executionId: "e1",
          type: TimerType.SignalTimeout,
          fireAt: contractT0,
          status: TimerStatus.Pending,
        });
        expect(
          await store.commitSignalDelivery!({
            executionId: "e1",
            signalId: "s-live",
            stepId: "w-live",
            stepResult: liveStep,
            signalRecord: liveSig,
            timerId: "wt-1",
          }),
        ).toBe(true);
        await store.saveStepResult({
          executionId: "e1",
          stepId: "w-notimer",
          result: { state: "waiting", signalId: "s-live" },
          completedAt: contractT0,
        });
        await store.upsertSignalWaiter({
          executionId: "e1",
          signalId: "s-live",
          stepId: "w-notimer",
          sortKey: "002",
        });
        expect(
          await store.commitSignalDelivery!({
            executionId: "e1",
            signalId: "s-live",
            stepId: "w-notimer",
            stepResult: { ...liveStep, stepId: "w-notimer" },
            signalRecord: liveSig,
          }),
        ).toBe(true);

        await store.saveExecution(
          makeSqlExecution("p-empty", { status: ExecutionStatus.Running }),
        );
        expect(
          await store.createContinuedExecution!({
            priorExecution: makeSqlExecution("p-empty", {
              status: ExecutionStatus.ContinuedAsNew,
            }),
            successorExecution: makeSqlExecution("s-empty"),
          }),
        ).toBe(true);
        await store.saveExecution(
          makeSqlExecution("p1", {
            status: ExecutionStatus.Running,
            workflowVersion: 1,
          }),
        );
        await store.enqueueCommand!({
          id: "c-blk",
          requestedExecutionId: "p1",
          executionId: "p1",
          taskKey: "t",
          workflowVersion: 1,
          input: 1,
          status: "pending",
          createdAt: contractT0,
        });
        expect(
          await store.createContinuedExecution!({
            priorExecution: makeSqlExecution("p1", {
              status: ExecutionStatus.ContinuedAsNew,
            }),
            successorExecution: makeSqlExecution("s1"),
          }),
        ).toBe(false);
        await store.completeCommand!({
          id: "c-blk",
          requestedExecutionId: "p1",
          executionId: "p1",
          taskKey: "t",
          workflowVersion: 1,
          input: 1,
          status: "failed",
          createdAt: contractT0,
          completedAt: contractT0,
        });
        await store.enqueueQueuedSignalRecord("p1", "sig-c", {
          id: "qc1",
          payload: "moved",
          receivedAt: contractT0,
        });
        expect(
          await store.createContinuedExecution!({
            priorExecution: makeSqlExecution("missing"),
            successorExecution: makeSqlExecution("s1"),
          }),
        ).toBe(false);
        expect(
          await store.createContinuedExecution!({
            priorExecution: makeSqlExecution("p1", {
              status: ExecutionStatus.ContinuedAsNew,
            }),
            successorExecution: makeSqlExecution("s1"),
          }),
        ).toBe(true);
        expect(
          (await store.consumeQueuedSignalRecord("s1", "sig-c"))?.payload,
        ).toBe("moved");

        const ewRes = {
          executionId: "parent",
          stepId: "ew1",
          result: { state: "completed", targetExecutionId: "target" },
          completedAt: contractT0,
        };
        expect(
          await store.commitExecutionWaiterCompletion!({
            targetExecutionId: "target",
            executionId: "parent",
            stepId: "missing-ew",
            stepResult: ewRes,
          }),
        ).toBe(false);
        await store.upsertExecutionWaiter({
          targetExecutionId: "target",
          executionId: "parent",
          stepId: "ew1",
        });
        expect(await store.listExecutionWaiters("target")).toHaveLength(1);
        expect(
          await store.commitExecutionWaiterCompletion!({
            targetExecutionId: "target",
            executionId: "parent",
            stepId: "ew1",
            stepResult: ewRes,
          }),
        ).toBe(false);
        await store.saveStepResult({
          executionId: "parent",
          stepId: "ew1",
          result: {
            state: "continued",
            targetExecutionId: "root",
            continuedAsExecutionId: "target",
            workflowKey: "wf",
          },
          completedAt: contractT0,
        });
        expect(
          await store.commitExecutionWaiterCompletion!({
            targetExecutionId: "target",
            executionId: "parent",
            stepId: "ew1",
            waitTargetExecutionId: "other",
            stepResult: ewRes,
          }),
        ).toBe(false);
        await store.createTimer({
          id: "ewt-1",
          executionId: "parent",
          type: TimerType.Sleep,
          fireAt: contractT0,
          status: TimerStatus.Pending,
        });
        expect(
          await store.commitExecutionWaiterCompletion!({
            targetExecutionId: "target",
            executionId: "parent",
            stepId: "ew1",
            waitTargetExecutionId: "root",
            timerId: "ewt-1",
            stepResult: ewRes,
          }),
        ).toBe(true);
        await store.saveStepResult({
          executionId: "parent",
          stepId: "ew2",
          result: { state: "waiting", targetExecutionId: "target" },
          completedAt: contractT0,
        });
        await store.upsertExecutionWaiter({
          targetExecutionId: "target",
          executionId: "parent",
          stepId: "ew2",
        });
        expect(
          await store.commitExecutionWaiterCompletion!({
            targetExecutionId: "target",
            executionId: "parent",
            stepId: "ew2",
            stepResult: { ...ewRes, stepId: "ew2" },
          }),
        ).toBe(true);
        await store.deleteExecutionWaiter("target", "parent", "ew1");
      } finally {
        await store.dispose!();
      }
    });
  });
}
