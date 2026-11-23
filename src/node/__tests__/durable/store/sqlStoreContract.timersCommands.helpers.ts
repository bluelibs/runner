import {
  ScheduleStatus,
  ScheduleType,
  TimerStatus,
  TimerType,
} from "../../../durable/core/types";
import {
  contractT0,
  type SqlContractFactory,
} from "./sqlStoreContract.exec.helpers";
import { registerSqlCommandsLocksContractTests } from "./sqlStoreContract.commandsLocks.helpers";

export function registerSqlTimersAndCommandsContractTests(
  label: string,
  factory: SqlContractFactory,
): void {
  describe(`${label}: timers and schedules`, () => {
    it("handles timers, claims, and schedules", async () => {
      const store = await factory.createStore({ namespace: "coord-ops" });
      try {
        await store.createTimer({
          id: "tm1",
          executionId: "ex",
          type: TimerType.Sleep,
          fireAt: contractT0,
          status: TimerStatus.Pending,
        });
        expect(await store.getExecutionTimers!("ex")).toHaveLength(1);
        expect(
          await store.claimReadyTimers(
            new Date(contractT0.getTime() + 1_000),
            0,
            "w1",
            5_000,
          ),
        ).toEqual([]);
        expect(
          await store.claimReadyTimers(
            new Date(contractT0.getTime() + 1_000),
            5,
            "w1",
            5_000,
          ),
        ).toHaveLength(1);
        expect(
          await store.claimReadyTimers(
            new Date(contractT0.getTime() + 1_000),
            5,
            "w2",
            5_000,
          ),
        ).toEqual([]);
        expect(await store.claimTimer!("tm1", "w2", 5_000)).toBe(false);
        expect(await store.renewTimerClaim!("tm1", "w2", 5_000)).toBe(false);
        expect(await store.renewTimerClaim!("tm1", "w1", 5_000)).toBe(true);
        expect(await store.releaseTimerClaim!("tm1", "w2")).toBe(false);
        expect(await store.releaseTimerClaim!("tm1", "w1")).toBe(true);
        expect(await store.claimTimer!("tm2", "w1", 5_000)).toBe(true);
        expect(await store.finalizeClaimedTimer!("tm2", "w2")).toBe(false);
        expect(await store.finalizeClaimedTimer!("tm2", "w1")).toBe(true);
        expect(
          await store.getReadyTimers(new Date(contractT0.getTime() + 1_000)),
        ).toHaveLength(1);
        await store.markTimerFired("missing");
        await store.markTimerFired("tm1");
        expect(await store.getReadyTimers(contractT0)).toEqual([]);
        expect(await store.getReadyTimers()).toEqual([]);
        await store.deleteTimer("tm1");

        const sched = {
          id: "sc1",
          workflowKey: "wf",
          type: ScheduleType.Interval,
          pattern: "1000",
          input: {},
          status: ScheduleStatus.Active,
          createdAt: contractT0,
          updatedAt: contractT0,
        };
        await store.createSchedule(sched);
        expect(await store.getSchedule("missing")).toBeNull();
        expect((await store.getSchedule("sc1"))?.id).toBe("sc1");
        await store.updateSchedule("missing", {
          status: ScheduleStatus.Paused,
        });
        await store.updateSchedule("sc1", { status: ScheduleStatus.Paused });
        await expect(
          store.updateSchedule("sc1", { id: "renamed" } as never),
        ).rejects.toThrow(/schedule id/i);
        await store.saveScheduleWithTimer(
          { ...sched, status: ScheduleStatus.Active },
          {
            id: "sched:sc1",
            scheduleId: "sc1",
            type: TimerType.Scheduled,
            fireAt: contractT0,
            status: TimerStatus.Pending,
          },
        );
        expect(await store.listSchedules()).toHaveLength(1);
        expect(await store.listActiveSchedules()).toHaveLength(1);
        await store.deleteSchedule("sc1");
      } finally {
        await store.dispose!();
      }
    });
  });

  registerSqlCommandsLocksContractTests(label, factory);
}
