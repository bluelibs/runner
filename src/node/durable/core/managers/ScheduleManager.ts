import type { IDurableStore } from "../interfaces/store";
import type { DurableTask, ScheduleOptions } from "../interfaces/service";
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

/**
 * Handles scheduling of durable workflows - cron, intervals, and one-time delays.
 */
export class ScheduleManager {
  constructor(
    private readonly store: IDurableStore,
    private readonly taskRegistry: TaskRegistry,
  ) {}

  async ensureSchedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions & { id: string },
  ): Promise<string> {
    if (!options.cron && options.interval === undefined) {
      throw new Error("ensureSchedule() requires cron or interval");
    }

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
        throw new Error(`Failed to acquire schedule lock for '${scheduleId}'`);
      }
    }

    try {
      const existing = await this.store.getSchedule(scheduleId);

      const type = options.cron ? ScheduleType.Cron : ScheduleType.Interval;
      const pattern = options.cron ?? String(options.interval);

      if (existing) {
        if (existing.taskId !== task.id) {
          throw new Error(
            `Schedule '${scheduleId}' already exists for task '${existing.taskId}', cannot rebind to '${task.id}'`,
          );
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

      const schedule: Schedule<TInput> = {
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

  async schedule<TInput>(
    task: DurableTask<TInput, unknown>,
    input: TInput | undefined,
    options: ScheduleOptions,
  ): Promise<string> {
    this.taskRegistry.register(task);

    const id = options.id ?? createExecutionId();

    if (options.cron || options.interval !== undefined) {
      const schedule: Schedule<TInput> = {
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
    const now = new Date();

    let nextRun: Date;
    if (schedule.type === ScheduleType.Cron) {
      nextRun = CronParser.getNextRun(schedule.pattern);
    } else {
      const intervalMs = Number(schedule.pattern);
      nextRun = new Date(now.getTime() + intervalMs);
    }

    await this.store.createTimer({
      id: `sched:${schedule.id}`,
      scheduleId: schedule.id,
      taskId: schedule.taskId,
      input: schedule.input,
      type: TimerType.Scheduled,
      fireAt: nextRun,
      status: TimerStatus.Pending,
    });

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

    await this.store.updateSchedule(id, {
      status: ScheduleStatus.Active,
      updatedAt: new Date(),
    });

    await this.reschedule(schedule);
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
    const pattern =
      updates.cron ??
      (updates.interval !== undefined ? String(updates.interval) : undefined);

    await this.store.updateSchedule(id, {
      pattern,
      input: updates.input,
      updatedAt: new Date(),
    });
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteSchedule(id);
  }
}
