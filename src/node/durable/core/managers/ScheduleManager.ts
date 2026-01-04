import type { IDurableStore } from "../interfaces/store";
import type { DurableTask, ScheduleOptions } from "../interfaces/service";
import type { Schedule } from "../types";
import { CronParser } from "../CronParser";
import { createExecutionId } from "../utils";
import type { TaskRegistry } from "./TaskRegistry";

/**
 * Handles scheduling of durable workflows - cron, intervals, and one-time delays.
 */
export class ScheduleManager {
  constructor(
    private readonly store: IDurableStore,
    private readonly taskRegistry: TaskRegistry,
  ) {}

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
        type: options.cron ? "cron" : "interval",
        status: "active",
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
      type: "scheduled",
      fireAt,
      status: "pending",
    });

    return id;
  }

  async reschedule(
    schedule: Schedule,
    options?: { lastRunAt?: Date },
  ): Promise<void> {
    const now = new Date();

    let nextRun: Date;
    if (schedule.type === "cron") {
      nextRun = CronParser.getNextRun(schedule.pattern);
    } else {
      const intervalMs = Number(schedule.pattern);
      nextRun = new Date(now.getTime() + intervalMs);
    }

    await this.store.createTimer({
      id: `sched:${schedule.id}:${nextRun.getTime()}`,
      scheduleId: schedule.id,
      taskId: schedule.taskId,
      input: schedule.input,
      type: "scheduled",
      fireAt: nextRun,
      status: "pending",
    });

    await this.store.updateSchedule(schedule.id, {
      lastRun: options?.lastRunAt,
      nextRun,
      updatedAt: new Date(),
    });
  }

  async pause(id: string): Promise<void> {
    await this.store.updateSchedule(id, { status: "paused" });
  }

  async resume(id: string): Promise<void> {
    const schedule = await this.store.getSchedule(id);
    if (!schedule) return;

    await this.store.updateSchedule(id, {
      status: "active",
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
