type IdleWaiter = {
  threshold: number;
  resolve: () => void;
};

/**
 * Tracks in-flight async work and allows callers to await idle state.
 *
 * Why this exists:
 * Task and event execution both need identical shutdown-drain semantics,
 * and keeping that logic in one place prevents subtle drift.
 */
export class InFlightTracker {
  private inFlightCount = 0;
  private readonly idleWaiters = new Set<IdleWaiter>();

  constructor(
    private readonly isInsideTrackedContext?: (() => boolean) | null,
  ) {}

  start() {
    this.inFlightCount += 1;
  }

  end() {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    this.resolveIdleWaiters();
  }

  waitForIdle(options?: { allowCurrentContext?: boolean }): Promise<void> {
    const threshold =
      options?.allowCurrentContext && this.isInsideTrackedContext?.() ? 1 : 0;

    if (this.inFlightCount <= threshold) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.idleWaiters.add({ threshold, resolve });
    });
  }

  reset() {
    this.inFlightCount = 0;
    this.idleWaiters.clear();
  }

  getCount() {
    return this.inFlightCount;
  }

  private resolveIdleWaiters() {
    for (const waiter of this.idleWaiters) {
      if (this.inFlightCount <= waiter.threshold) {
        waiter.resolve();
        this.idleWaiters.delete(waiter);
      }
    }
  }
}
