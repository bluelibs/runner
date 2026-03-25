import type { IDurableStore } from "../interfaces/store";
import type {
  EnsureScheduleOptions,
  ScheduleOptions,
  UpdateScheduleOptions,
} from "../interfaces/service";
import {
  ScheduleStatus,
  ScheduleType,
  TimerStatus,
  TimerType,
  type Schedule,
} from "../types";
import { CronParser } from "../CronParser";
import { createExecutionId, sleepMs } from "../utils";
import { withStoreLock } from "../locking";
import type { TaskRegistry } from "./TaskRegistry";
import type { ITask } from "../../../../types/task";
import {
  durableExecutionInvariantError,
  durableScheduleConfigError,
} from "../../../../errors";

/**
 * Creates and maintains durable schedules.
 *
 * A schedule is persisted in the store and translated into durable timers that
 * `PollingManager` will later process to kick off executions. This keeps scheduling
 * crash-safe and horizontally scalable: schedules aren't owned by in-memory timers.
 */
export class ScheduleManager {
  constructor(
    private readonly store: IDurableStore,
    private readonly taskRegistry: TaskRegistry,
  ) {}

  async ensureSchedule(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: EnsureScheduleOptions & { id: string },
  ): Promise<string> {
    if (!options.cron && options.interval === undefined) {
      durableScheduleConfigError.throw({
        message: "ensureSchedule() requires cron or interval",
      });
    }

    const task = this.resolveTaskReference(taskRef, "ensureSchedule");
    this.taskRegistry.register(task);

    const scheduleId = options.id;

    return await withStoreLock({
      store: this.store,
      resource: `schedule:${scheduleId}`,
      ttlMs: 10_000,
      maxAttempts: 20,
      retryDelayMs: 5,
      sleep: sleepMs,
      onLockUnavailable: () =>
        durableScheduleConfigError.throw({
          message: `Failed to acquire schedule lock for '${scheduleId}'`,
        }),
      fn: async () => {
        const existing = await this.store.getSchedule(scheduleId);
        const workflowKey = this.taskRegistry.getWorkflowKey(task);

        const type = options.cron ? ScheduleType.Cron : ScheduleType.Interval;
        const pattern = options.cron ?? String(options.interval);
        const timezone = options.cron ? options.timezone : undefined;

        if (existing) {
          if (existing.workflowKey !== workflowKey) {
            durableScheduleConfigError.throw({
              message: `Schedule '${scheduleId}' already exists for workflow '${existing.workflowKey}', cannot rebind to '${workflowKey}'`,
            });
          }

          await this.reschedule({
            ...existing,
            type,
            pattern,
            timezone,
            input,
            status: ScheduleStatus.Active,
            updatedAt: new Date(),
          });

          return scheduleId;
        }

        const schedule: Schedule = {
          id: scheduleId,
          workflowKey,
          input,
          pattern,
          timezone,
          type,
          status: ScheduleStatus.Active,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await this.reschedule(schedule);
        return scheduleId;
      },
    });
  }

  async schedule(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    input: unknown,
    options: ScheduleOptions,
  ): Promise<string> {
    const task = this.resolveTaskReference(taskRef, "schedule");
    this.taskRegistry.register(task);

    const id = options.id ?? createExecutionId();

    if (options.cron || options.interval !== undefined) {
      const workflowKey = this.taskRegistry.getWorkflowKey(task);
      const schedule: Schedule = {
        id,
        workflowKey,
        input,
        pattern: options.cron ?? String(options.interval),
        timezone: options.cron ? options.timezone : undefined,
        type: options.cron ? ScheduleType.Cron : ScheduleType.Interval,
        status: ScheduleStatus.Active,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.reschedule(schedule);
      return id;
    }

    const delay = options.delay ?? 0;
    const fireAt = options.at ?? new Date(Date.now() + delay);

    await this.store.createTimer({
      id: `once:${id}`,
      workflowKey: this.taskRegistry.getWorkflowKey(task),
      input,
      type: TimerType.Scheduled,
      fireAt,
      status: TimerStatus.Pending,
    });

    return id;
  }

  async reschedule(
    schedule: Schedule,
    options?: { lastRunAt?: Date; nextRunAnchorMs?: number },
  ): Promise<void> {
    const nextRun = this.computeNextRun(schedule, options?.nextRunAnchorMs);
    await this.saveScheduleWithTimer({
      ...schedule,
      lastRun: options?.lastRunAt ?? schedule.lastRun,
      nextRun,
      updatedAt: new Date(),
    });
  }

  async pause(id: string): Promise<void> {
    await this.store.updateSchedule(id, { status: ScheduleStatus.Paused });
  }

  async resume(id: string): Promise<void> {
    const schedule = await this.store.getSchedule(id);
    if (!schedule) return;
    if (schedule.status === ScheduleStatus.Active) return;

    await this.reschedule({
      ...schedule,
      status: ScheduleStatus.Active,
      updatedAt: new Date(),
    });
  }

  async get(id: string): Promise<Schedule | null> {
    return this.store.getSchedule(id);
  }

  async list(): Promise<Schedule[]> {
    return this.store.listSchedules();
  }

  async update(id: string, updates: UpdateScheduleOptions): Promise<void> {
    const existing = await this.store.getSchedule(id);
    if (!existing) return;
    const hasInputUpdate = Object.prototype.hasOwnProperty.call(
      updates,
      "input",
    );
    const hasTimezoneUpdate = Object.prototype.hasOwnProperty.call(
      updates,
      "timezone",
    );
    this.assertValidScheduleUpdate(updates, hasTimezoneUpdate);

    const { type, pattern, timezone } = this.resolveUpdatedCadence(
      existing,
      updates,
    );
    const input = hasInputUpdate ? updates.input : existing.input;
    const updatedAt = new Date();
    const cadenceChanged =
      type !== existing.type ||
      pattern !== existing.pattern ||
      timezone !== existing.timezone;
    const updatedSchedule: Schedule = {
      ...existing,
      type,
      pattern,
      timezone,
      input,
      updatedAt,
    };

    // Fail fast before persisting an invalid cadence update.
    const updatedIntervalAnchorMs =
      cadenceChanged && type === ScheduleType.Interval
        ? (existing.lastRun?.getTime() ?? updatedAt.getTime())
        : undefined;

    if (cadenceChanged) {
      this.computeNextRun(updatedSchedule, updatedIntervalAnchorMs);
    }

    if (existing.status !== ScheduleStatus.Active) {
      await this.store.updateSchedule(id, {
        type,
        pattern,
        timezone,
        input,
        updatedAt,
      });
      return;
    }

    if (cadenceChanged) {
      await this.reschedule(updatedSchedule, {
        nextRunAnchorMs: updatedIntervalAnchorMs,
      });
      return;
    }

    if (existing.nextRun) {
      await this.saveScheduleWithTimer({
        ...updatedSchedule,
        nextRun: existing.nextRun,
      });
      return;
    }

    await this.store.updateSchedule(id, {
      type,
      pattern,
      timezone,
      input,
      updatedAt,
    });
  }

  private computeNextRun(schedule: Schedule, anchorMs?: number): Date {
    if (schedule.type === ScheduleType.Cron) {
      return CronParser.getNextRun(
        schedule.pattern,
        new Date(),
        schedule.timezone,
      );
    }

    const intervalMs = Number(schedule.pattern);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      durableScheduleConfigError.throw({
        message: `Schedule '${schedule.id}' has invalid interval '${schedule.pattern}'`,
      });
    }

    const nowMs = Date.now();
    const resolvedAnchorMs =
      anchorMs ??
      schedule.nextRun?.getTime() ??
      schedule.lastRun?.getTime() ??
      schedule.createdAt.getTime();
    const firstCandidateMs = resolvedAnchorMs + intervalMs;
    if (firstCandidateMs > nowMs) {
      return new Date(firstCandidateMs);
    }

    const intervalsBehind =
      Math.floor((nowMs - resolvedAnchorMs) / intervalMs) + 1;
    return new Date(resolvedAnchorMs + intervalsBehind * intervalMs);
  }

  private async saveScheduleWithTimer(schedule: Schedule): Promise<void> {
    const nextRun = schedule.nextRun;
    if (!nextRun) {
      return durableExecutionInvariantError.throw({
        message: `Schedule '${schedule.id}' must have nextRun before arming its timer.`,
      });
    }

    await this.store.saveScheduleWithTimer(schedule, {
      id: `sched:${schedule.id}`,
      scheduleId: schedule.id,
      workflowKey: schedule.workflowKey,
      input: schedule.input,
      type: TimerType.Scheduled,
      fireAt: nextRun,
      status: TimerStatus.Pending,
    });
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteSchedule(id);
  }

  private resolveUpdatedCadence(
    existing: Schedule,
    updates: UpdateScheduleOptions,
  ): Pick<Schedule, "type" | "pattern" | "timezone"> {
    if (updates.cron !== undefined) {
      return {
        type: ScheduleType.Cron,
        pattern: updates.cron,
        timezone: updates.timezone,
      };
    }

    if (updates.interval !== undefined) {
      return {
        type: ScheduleType.Interval,
        pattern: String(updates.interval),
        timezone: undefined,
      };
    }

    return {
      type: existing.type,
      pattern: existing.pattern,
      timezone:
        existing.type === ScheduleType.Cron ? existing.timezone : undefined,
    };
  }

  private assertValidScheduleUpdate(
    updates: UpdateScheduleOptions,
    hasTimezoneUpdate: boolean,
  ): void {
    if (updates.cron !== undefined && updates.interval !== undefined) {
      durableScheduleConfigError.throw({
        message: "updateSchedule() accepts cron or interval, not both",
      });
    }

    if (!hasTimezoneUpdate) return;

    if (updates.cron === undefined) {
      durableScheduleConfigError.throw({
        message:
          "updateSchedule() cannot set timezone without cron. Timezone is only supported for cron schedules.",
      });
    }
  }

  private resolveTaskReference(
    taskRef: string | ITask<any, Promise<any>, any, any, any, any>,
    apiMethod: string,
  ): ITask<any, Promise<any>, any, any, any, any> {
    if (typeof taskRef !== "string") {
      return taskRef;
    }

    const resolved = this.taskRegistry.find(taskRef);
    if (!resolved) {
      durableExecutionInvariantError.throw({
        message: `DurableService.${apiMethod}() could not resolve task id "${taskRef}". Ensure the task is registered in the runtime store.`,
      });
    }
    return resolved!;
  }
}
