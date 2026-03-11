export interface ITimerHandle {
  cancel(): void;
}

export interface ITimers {
  /**
   * Schedules a one-off callback tied to the runner timers resource lifecycle.
   */
  setTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): ITimerHandle;

  /**
   * Schedules a non-overlapping interval tied to the runner timers resource lifecycle.
   */
  setInterval(
    callback: () => void | Promise<void>,
    everyMs: number,
  ): ITimerHandle;
}
