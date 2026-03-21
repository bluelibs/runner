import type { IDurableStore } from "../interfaces/store";
import type {
  EnsureScheduleOptions,
  ScheduleOptions,
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
        const persistedTaskId = this.taskRegistry.getPersistenceId(task);

        const type = options.cron ? ScheduleType.Cron : ScheduleType.Interval;
        const pattern = options.cron ?? String(options.interval);

        if (existing) {
          if (existing.taskId !== persistedTaskId) {
            durableScheduleConfigError.throw({
              message: `Schedule '${scheduleId}' already exists for task '${existing.taskId}', cannot rebind to '${persistedTaskId}'`,
            });
          }

          await this.reschedule({
            ...existing,
            type,
            pattern,
            input,
            status: ScheduleStatus.Active,
            updatedAt: new Date(),
          });

          return scheduleId;
        }

        const schedule: Schedule = {
          id: scheduleId,
          taskId: persistedTaskId,
          input,
          pattern,
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
      const persistedTaskId = this.taskRegistry.getPersistenceId(task);
      const schedule: Schedule = {
        id,
        taskId: persistedTaskId,
        input,
        pattern: options.cron ?? String(options.interval),
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
      taskId: this.taskRegistry.getPersistenceId(task),
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
    await this.saveScheduleWithTimer({
      ...schedule,
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

    if (existing.status !== ScheduleStatus.Active) {
      await this.store.updateSchedule(id, {
        type,
        pattern,
        input,
        updatedAt,
      });
      return;
    }

    if (cadenceChanged) {
      await this.reschedule(updatedSchedule);
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
      input,
      updatedAt,
    });
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
      taskId: schedule.taskId,
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
