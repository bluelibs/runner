import type { IDurableStore } from "../interfaces/store";
import type { ScheduleOptions } from "../interfaces/service";
import {
  ScheduleStatus,
  ScheduleType,
  TimerStatus,
  TimerType,
  type Schedule,
} from "../types";
import { CronParser } from "../CronParser";
import { createExecutionId, sleepMs } from "../utils";
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
    options: ScheduleOptions & { id: string },
  ): Promise<string> {
    if (!options.cron && options.interval === undefined) {
      durableScheduleConfigError.throw({
        message: "ensureSchedule() requires cron or interval",
      });
    }

    const task = this.resolveTaskReference(taskRef, "ensureSchedule");
    this.taskRegistry.register(task);

    const scheduleId = options.id;

    const lockTtlMs = 10_000;
    const lockResource = `schedule:${scheduleId}`;
    const canLock = !!this.store.acquireLock && !!this.store.releaseLock;

    let lockId: string | null = null;
    if (canLock) {
      const maxAttempts = 20;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        lockId = await this.store.acquireLock!(lockResource, lockTtlMs);
        if (lockId !== null) break;
        await sleepMs(5);
      }
      if (lockId === null) {
        durableScheduleConfigError.throw({
          message: `Failed to acquire schedule lock for '${scheduleId}'`,
        });
      }
    }

    try {
      const existing = await this.store.getSchedule(scheduleId);

      const type = options.cron ? ScheduleType.Cron : ScheduleType.Interval;
      const pattern = options.cron ?? String(options.interval);

      if (existing) {
        if (existing.taskId !== task.id) {
          durableScheduleConfigError.throw({
            message: `Schedule '${scheduleId}' already exists for task '${existing.taskId}', cannot rebind to '${task.id}'`,
          });
        }

        await this.store.updateSchedule(scheduleId, {
          type,
          pattern,
          input,
          status: ScheduleStatus.Active,
          updatedAt: new Date(),
        });

        const updated = await this.store.getSchedule(scheduleId);
        if (updated) {
          await this.reschedule(updated);
        }

        return scheduleId;
      }

      const schedule: Schedule = {
        id: scheduleId,
        taskId: task.id,
        input,
        pattern,
        type,
        status: ScheduleStatus.Active,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.store.createSchedule(schedule);
      await this.reschedule(schedule);
      return scheduleId;
    } finally {
      if (canLock && lockId !== null) {
        try {
          await this.store.releaseLock!(lockResource, lockId);
        } catch {
          // best-effort cleanup; ignore
        }
      }
    }
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
      const schedule: Schedule = {
        id,
        taskId: task.id,
        input,
        pattern: options.cron ?? String(options.interval),
        type: options.cron ? ScheduleType.Cron : ScheduleType.Interval,
        status: ScheduleStatus.Active,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.store.createSchedule(schedule);
      await this.reschedule(schedule);
      return id;
    }

    const delay = options.delay ?? 0;
    const fireAt = options.at ?? new Date(Date.now() + delay);

    await this.store.createTimer({
      id: `once:${id}`,
      taskId: task.id,
      input,
      type: TimerType.Scheduled,
      fireAt,
      status: TimerStatus.Pending,
    });

    return id;
  }

  async reschedule(
    schedule: Schedule,
    options?: { lastRunAt?: Date },
  ): Promise<void> {
    const nextRun = this.computeNextRun(schedule);
    await this.armScheduleTimer(schedule, nextRun);

    await this.store.updateSchedule(schedule.id, {
      lastRun: options?.lastRunAt,
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

    await this.store.updateSchedule(id, {
      status: ScheduleStatus.Active,
      updatedAt: new Date(),
    });

    await this.reschedule({
      ...schedule,
      status: ScheduleStatus.Active,
    });
  }

  async get(id: string): Promise<Schedule | null> {
    return this.store.getSchedule(id);
  }

  async list(): Promise<Schedule[]> {
    return this.store.listSchedules();
  }

  async update(
    id: string,
    updates: { cron?: string; interval?: number; input?: unknown },
  ): Promise<void> {
    const existing = await this.store.getSchedule(id);
    if (!existing) return;
    const hasInputUpdate = Object.prototype.hasOwnProperty.call(
      updates,
      "input",
    );

    const { type, pattern } = this.resolveUpdatedCadence(existing, updates);
    const input = hasInputUpdate ? updates.input : existing.input;
    const updatedAt = new Date();
    const cadenceChanged =
      type !== existing.type || pattern !== existing.pattern;
    const updatedSchedule: Schedule = {
      ...existing,
      type,
      pattern,
      input,
      updatedAt,
    };

    // Fail fast before persisting an invalid cadence update.
    if (cadenceChanged) {
      this.computeNextRun(updatedSchedule);
    }

    await this.store.updateSchedule(id, {
      type,
      pattern,
      input,
      updatedAt,
    });

    if (existing.status !== ScheduleStatus.Active) {
      return;
    }

    if (cadenceChanged) {
      await this.reschedule(updatedSchedule);
      return;
    }

    if (existing.nextRun) {
      await this.armScheduleTimer(updatedSchedule, existing.nextRun);
    }
  }

  private computeNextRun(schedule: Schedule): Date {
    if (schedule.type === ScheduleType.Cron) {
      return CronParser.getNextRun(schedule.pattern);
    }

    const intervalMs = Number(schedule.pattern);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      durableScheduleConfigError.throw({
        message: `Schedule '${schedule.id}' has invalid interval '${schedule.pattern}'`,
      });
    }
    return new Date(Date.now() + intervalMs);
  }

  private async armScheduleTimer(
    schedule: Schedule,
    fireAt: Date,
  ): Promise<void> {
    await this.store.createTimer({
      id: `sched:${schedule.id}`,
      scheduleId: schedule.id,
      taskId: schedule.taskId,
      input: schedule.input,
      type: TimerType.Scheduled,
      fireAt,
      status: TimerStatus.Pending,
    });
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteSchedule(id);
  }

  private resolveUpdatedCadence(
    existing: Schedule,
    updates: { cron?: string; interval?: number },
  ): Pick<Schedule, "type" | "pattern"> {
    if (updates.cron !== undefined) {
      return {
        type: ScheduleType.Cron,
        pattern: updates.cron,
      };
    }

    if (updates.interval !== undefined) {
      return {
        type: ScheduleType.Interval,
        pattern: String(updates.interval),
      };
    }

    return {
      type: existing.type,
      pattern: existing.pattern,
    };
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
