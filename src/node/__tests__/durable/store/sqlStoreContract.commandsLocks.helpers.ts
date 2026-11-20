import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import { ExecutionStatus } from "../../../durable/core/types";
import {
  contractT0,
  makeSqlExecution,
  type SqlContractFactory,
} from "./sqlStoreContract.exec.helpers";

export function registerSqlCommandsLocksContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: commands, locks, and ownership fencing`, () => {
    it("handles command queuing/completion, locks, and ownership fencing", async () => {
      const store = await factory.createStore({ namespace: "coord-cmd" });
      try {
        const runExec = makeSqlExecution("run-cmd", {
          status: ExecutionStatus.Running,
          workflowVersion: 1,
          historyRecorded: true,
        });
        await store.saveExecution(runExec);
        await expect(
          store.enqueueCommand!({
            id: "missing-exec-cmd",
            requestedExecutionId: "ghost-exec",
            executionId: "ghost-exec",
            taskKey: "cmd",
            workflowVersion: 1,
            input: 1,
            status: "pending",
            createdAt: contractT0,
          }),
        ).rejects.toThrow(/live execution/i);
        expect(
          await store.saveCommand!({
            id: "none",
            requestedExecutionId: "ghost-exec",
            executionId: "ghost-exec",
            taskKey: "cmd",
            workflowVersion: 1,
            input: 1,
            status: "pending",
            createdAt: contractT0,
          }),
        ).toBe(false);
        await expect(
          store.enqueueCommand!({
            id: "bad-c",
            requestedExecutionId: "run-cmd",
            executionId: "run-cmd",
            taskKey: "cmd",
            workflowVersion: 2,
            input: 1,
            status: "pending",
            createdAt: contractT0,
          }),
        ).rejects.toThrow(/live execution/i);

        const cmd1: DurableCommandRecord = {
          id: "c1",
          requestedExecutionId: "run-cmd",
          executionId: "run-cmd",
          taskKey: "cmd",
          workflowVersion: 1,
          input: 1,
          status: "pending",
          createdAt: contractT0,
        };
        const cmd2 = { ...cmd1, id: "c2" };
        await store.enqueueCommand!(cmd1);
        expect((await store.enqueueCommand!(cmd1)).id).toBe("c1");
        await store.enqueueCommand!(cmd2);
        expect((await store.getCommand!("c1"))?.id).toBe("c1");
        expect(await store.getCommand!("nope")).toBeNull();
        expect((await store.getNextCommand!("run-cmd"))?.id).toBe("c1");
        expect(await store.getNextCommand!("none")).toBeNull();
        expect(await store.saveCommand!({ ...cmd1, status: "running" })).toBe(
          true,
        );
        expect(await store.saveCommand!({ ...cmd2, status: "running" })).toBe(
          false,
        );
        expect(await store.rescheduleCommandTimer!("run-cmd", contractT0)).toBe(
          true,
        );
        expect(await store.rescheduleCommandTimer!("none", contractT0)).toBe(
          false,
        );
        expect(
          await store.completeCommand!(
            {
              ...cmd2,
              status: "completed",
              state: { value: 1 },
              completedAt: contractT0,
            },
            runExec,
          ),
        ).toBe(false);
        expect(
          await store.completeCommand!(
            {
              ...cmd1,
              status: "completed",
              state: { value: { a: 1 } },
              completedAt: contractT0,
            },
            undefined,
          ),
        ).toBe(false);
        expect(
          await store.completeCommand!(
            {
              ...cmd1,
              status: "completed",
              state: { value: { a: 1 } },
              completedAt: contractT0,
            },
            makeSqlExecution("wrong"),
          ),
        ).toBe(false);
        expect(
          await store.completeCommand!(
            {
              ...cmd1,
              status: "completed",
              state: { value: { a: 1 } },
              completedAt: contractT0,
            },
            runExec,
          ),
        ).toBe(true);
        expect((await store.getWorkflowState!("run-cmd"))?.state).toEqual({
          a: 1,
        });
        expect(
          await store.completeCommand!(
            {
              ...cmd2,
              status: "completed",
              state: null,
              completedAt: contractT0,
            },
            runExec,
          ),
        ).toBe(true);
        expect(await store.getWorkflowState!("run-cmd")).toBeNull();

        const noHistExec = makeSqlExecution("no-hist-cmd", {
          status: ExecutionStatus.Running,
          workflowVersion: 1,
          historyRecorded: false,
        });
        await store.saveExecution(noHistExec);
        const cmdNh = {
          ...cmd1,
          id: "c-nh",
          requestedExecutionId: "no-hist-cmd",
          executionId: "no-hist-cmd",
        };
        await store.enqueueCommand!(cmdNh);
        expect(
          await store.completeCommand!(
            {
              ...cmdNh,
              status: "completed",
              state: { value: { k: 1 } },
              completedAt: contractT0,
            },
            noHistExec,
          ),
        ).toBe(true);

        const ghostCmd = {
          ...cmd1,
          id: "c-ghost",
          requestedExecutionId: "no-hist-cmd",
          executionId: "no-hist-cmd",
        };
        await store.enqueueCommand!(ghostCmd);
        const internals = store as unknown as {
          runtime: {
            namespace: string;
            backend: {
              run: (
                sql: string,
                p: readonly (string | number | null)[],
              ) => Promise<void>;
            };
          };
        };
        await internals.runtime.backend.run(
          `DELETE FROM runner_durable_executions WHERE namespace = ? AND id = ?`,
          [internals.runtime.namespace, "no-hist-cmd"],
        );
        expect(
          await store.completeCommand!(
            { ...ghostCmd, status: "completed", completedAt: contractT0 },
            noHistExec,
          ),
        ).toBe(false);

        const lockId = await store.acquireLock!("execution:owned", 10_000);
        expect(lockId).not.toBeNull();
        expect(await store.acquireLock!("execution:owned", 10_000)).toBeNull();
        expect(await store.hasExecutionLease!("owned")).toBe(true);
        expect(await store.renewLock!("execution:owned", "wrong", 10_000)).toBe(
          false,
        );
        expect(await store.renewLock!("execution:owned", lockId!, 10_000)).toBe(
          true,
        );

        let lost = 0;
        const ownedStore = store.withExecutionOwnership!({
          executionId: "owned",
          lockId: lockId!,
          onLost: () => {
            lost += 1;
            throw new Error("lease-lost");
          },
        });
        await ownedStore.saveExecution(makeSqlExecution("owned"));
        expect(lost).toBe(0);
        await store.releaseLock!("execution:owned", lockId!);
        expect(await store.hasExecutionLease!("owned")).toBe(false);
        await expect(
          ownedStore.saveExecution(makeSqlExecution("owned-fail")),
        ).rejects.toThrow("lease-lost");
        expect(lost).toBe(1);
        expect(await store.getExecution("owned-fail")).toBeNull();
      } finally {
        await store.dispose!();
      }
    });
  });
}
