import type { ITimerHandle, ITimers } from "../../types/timers";
import type { OnUnhandledError } from "../UnhandledError";
import { safeReportUnhandledError } from "../UnhandledError";
import { runtimeTimersNotAcceptingError } from "../../errors";

type RuntimeTimerCallback = () => void | Promise<void>;

type RuntimeTimerState = {
  cancel: () => void;
};

export class RuntimeTimers implements ITimers {
  private readonly timers = new Set<RuntimeTimerState>();
  private acceptingNewTimers = true;
  private disposed = false;

  constructor(private readonly onUnhandledError: OnUnhandledError) {}

  public setTimeout(
    callback: RuntimeTimerCallback,
    delayMs: number,
  ): ITimerHandle {
    this.ensureAcceptingTimers();

    let cancelled = false;
    const timeoutRef = setTimeout(() => {
      this.deleteTimer(state);
      void this.runCallback(callback, "runner.timers.setTimeout");
    }, delayMs);

    const state: RuntimeTimerState = {
      cancel: () => {
        if (cancelled) {
          return;
        }

        cancelled = true;
        clearTimeout(timeoutRef);
        this.deleteTimer(state);
      },
    };

    this.timers.add(state);
    return state;
  }

  public setInterval(
    callback: RuntimeTimerCallback,
    everyMs: number,
  ): ITimerHandle {
    this.ensureAcceptingTimers();

    let cancelled = false;
    let timeoutRef: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = () => {
      if (cancelled || this.disposed) {
        return;
      }

      timeoutRef = setTimeout(async () => {
        await this.runCallback(callback, "runner.timers.setInterval");
        scheduleNext();
      }, everyMs);
    };

    const state: RuntimeTimerState = {
      cancel: () => {
        if (cancelled) {
          return;
        }

        cancelled = true;
        /* istanbul ignore next: scheduleNext() assigns the handle synchronously. */
        if (timeoutRef) {
          clearTimeout(timeoutRef);
        }
        this.deleteTimer(state);
      },
    };

    this.timers.add(state);
    scheduleNext();
    return state;
  }

  public cooldown(): void {
    this.acceptingNewTimers = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.acceptingNewTimers = false;
    this.disposed = true;
    for (const timer of Array.from(this.timers)) {
      timer.cancel();
    }
  }

  private deleteTimer(timer: RuntimeTimerState): void {
    this.timers.delete(timer);
  }

  private ensureAcceptingTimers(): void {
    if (this.acceptingNewTimers && !this.disposed) {
      return;
    }

    runtimeTimersNotAcceptingError.throw();
  }

  private async runCallback(
    callback: RuntimeTimerCallback,
    source: string,
  ): Promise<void> {
    try {
      await callback();
    } catch (error) {
      await safeReportUnhandledError(this.onUnhandledError, {
        error,
        kind: "run",
        source,
      });
    }
  }
}
