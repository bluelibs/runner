import {
  RuntimeCallSource,
  RuntimeCallSourceKind,
} from "../../types/runtimeSource";

export const RuntimeLifecyclePhase = {
  Running: "running",
  Paused: "paused",
  CoolingDown: "coolingDown",
  Disposing: "disposing",
  Aborting: "aborting",
  Drained: "drained",
  Disposed: "disposed",
} as const;

export type RuntimeLifecyclePhase =
  (typeof RuntimeLifecyclePhase)[keyof typeof RuntimeLifecyclePhase];

type DrainWaiter = {
  resolve: (drained: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const internalSourceKinds = new Set<RuntimeCallSourceKind>([
  RuntimeCallSourceKind.Task,
  RuntimeCallSourceKind.Hook,
  RuntimeCallSourceKind.TaskMiddleware,
  RuntimeCallSourceKind.ResourceMiddleware,
]);

export class LifecycleAdmissionController {
  private phase: RuntimeLifecyclePhase = RuntimeLifecyclePhase.Running;
  private inFlightTaskCount = 0;
  private inFlightEventCount = 0;
  private readonly activeInternalSources = new Map<string, number>();
  private readonly activeTaskAbortControllers = new Map<
    AbortController,
    number
  >();
  private readonly shutdownAllowedResourcePaths = new Set<string>();
  private readonly drainWaiters = new Set<DrainWaiter>();

  public getPhase(): RuntimeLifecyclePhase {
    return this.phase;
  }

  public isShutdownLockdown(): boolean {
    return (
      this.phase === RuntimeLifecyclePhase.Disposing ||
      this.phase === RuntimeLifecyclePhase.Aborting ||
      this.phase === RuntimeLifecyclePhase.Drained ||
      this.phase === RuntimeLifecyclePhase.Disposed
    );
  }

  public beginPausing(): void {
    if (this.phase !== RuntimeLifecyclePhase.Running) {
      return;
    }

    this.phase = RuntimeLifecyclePhase.Paused;
    this.resolveDrainWaitersIfDrained();
  }

  public resume(): void {
    if (this.phase !== RuntimeLifecyclePhase.Paused) {
      return;
    }

    this.phase = RuntimeLifecyclePhase.Running;
  }

  public allowShutdownResourceSource(resourcePath: string): void {
    if (
      this.phase !== RuntimeLifecyclePhase.CoolingDown &&
      this.phase !== RuntimeLifecyclePhase.Disposing &&
      this.phase !== RuntimeLifecyclePhase.Aborting
    ) {
      return;
    }

    this.shutdownAllowedResourcePaths.add(resourcePath);
  }

  public beginCoolingDown(): void {
    if (
      this.phase === RuntimeLifecyclePhase.CoolingDown ||
      this.phase === RuntimeLifecyclePhase.Disposing ||
      this.phase === RuntimeLifecyclePhase.Aborting ||
      this.phase === RuntimeLifecyclePhase.Drained ||
      this.phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }
    this.shutdownAllowedResourcePaths.clear();
    this.phase = RuntimeLifecyclePhase.CoolingDown;
    this.resolveDrainWaitersIfDrained();
  }

  public beginDisposing(): void {
    if (
      this.phase === RuntimeLifecyclePhase.Disposing ||
      this.phase === RuntimeLifecyclePhase.Aborting ||
      this.phase === RuntimeLifecyclePhase.Drained ||
      this.phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }
    this.phase = RuntimeLifecyclePhase.Disposing;
    this.resolveDrainWaitersIfDrained();
  }

  public beginAborting(): void {
    if (
      this.phase === RuntimeLifecyclePhase.Aborting ||
      this.phase === RuntimeLifecyclePhase.Drained ||
      this.phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }
    this.phase = RuntimeLifecyclePhase.Aborting;
    this.resolveDrainWaitersIfDrained();
  }

  public beginDrained(): void {
    if (this.phase === RuntimeLifecyclePhase.Disposed) {
      return;
    }
    this.phase = RuntimeLifecyclePhase.Drained;
    this.shutdownAllowedResourcePaths.clear();
    this.resolveDrainWaitersIfDrained();
  }

  public markDisposed(): void {
    this.phase = RuntimeLifecyclePhase.Disposed;
    this.shutdownAllowedResourcePaths.clear();
    this.resolveDrainWaitersIfDrained();
  }

  public canAdmitTask(source: RuntimeCallSource): boolean {
    return this.canAdmit(source);
  }

  public canAdmitEvent(
    source: RuntimeCallSource,
    options?: { allowLifecycleBypass?: boolean },
  ): boolean {
    if (options?.allowLifecycleBypass === true) {
      return true;
    }
    return this.canAdmit(source);
  }

  public async trackTaskExecution<T>(
    source: RuntimeCallSource,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.track(source, "task", execute);
  }

  public async trackEventEmission<T>(
    source: RuntimeCallSource,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.track(source, "event", execute);
  }

  public async trackHookExecution<T>(
    source: RuntimeCallSource,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.trackInternalSource(source, execute);
  }

  public async trackMiddlewareExecution<T>(
    source: RuntimeCallSource,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.trackInternalSource(source, execute);
  }

  public trackTaskAbortController(controller: AbortController): () => void {
    const current = this.activeTaskAbortControllers.get(controller) ?? 0;
    this.activeTaskAbortControllers.set(controller, current + 1);

    return () => {
      const remaining = this.activeTaskAbortControllers.get(controller);
      if (!remaining || remaining <= 1) {
        this.activeTaskAbortControllers.delete(controller);
        return;
      }

      this.activeTaskAbortControllers.set(controller, remaining - 1);
    };
  }

  public abortInFlightTaskSignals(reason: string): void {
    for (const controller of this.activeTaskAbortControllers.keys()) {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  }

  public async waitForDrain(timeoutMs: number): Promise<boolean> {
    if (this.isBusinessWorkDrained()) {
      return true;
    }

    if (timeoutMs <= 0) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const waiter: DrainWaiter = {
        resolve,
        timeout: setTimeout(() => {
          this.drainWaiters.delete(waiter);
          resolve(false);
        }, timeoutMs),
      };
      this.drainWaiters.add(waiter);
    });
  }

  public cancelDrainWaiters(): void {
    for (const waiter of Array.from(this.drainWaiters)) {
      clearTimeout(waiter.timeout);
      waiter.resolve(false);
      this.drainWaiters.delete(waiter);
    }
  }

  private canAdmit(source: RuntimeCallSource): boolean {
    if (this.phase === RuntimeLifecyclePhase.Running) {
      return true;
    }

    if (this.phase === RuntimeLifecyclePhase.Paused) {
      if (
        source.kind === RuntimeCallSourceKind.Runtime ||
        source.kind === RuntimeCallSourceKind.Resource
      ) {
        return false;
      }
      return this.getActiveInternalSourceCount(source) > 0;
    }

    if (this.phase === RuntimeLifecyclePhase.CoolingDown) {
      return true;
    }

    if (
      this.phase === RuntimeLifecyclePhase.Disposing ||
      this.phase === RuntimeLifecyclePhase.Aborting
    ) {
      if (source.kind === RuntimeCallSourceKind.Runtime) {
        return false;
      }
      if (source.kind === RuntimeCallSourceKind.Resource) {
        return this.shutdownAllowedResourcePaths.has(source.id);
      }
      return this.getActiveInternalSourceCount(source) > 0;
    }

    return false;
  }

  private async track<T>(
    source: RuntimeCallSource,
    counter: "task" | "event",
    execute: () => Promise<T>,
  ): Promise<T> {
    this.incrementInFlight(counter);
    this.incrementActiveInternalSource(source);
    try {
      return await execute();
    } finally {
      this.decrementActiveInternalSource(source);
      this.decrementInFlight(counter);
      this.resolveDrainWaitersIfDrained();
    }
  }

  private async trackInternalSource<T>(
    source: RuntimeCallSource,
    execute: () => Promise<T>,
  ): Promise<T> {
    this.incrementActiveInternalSource(source);
    try {
      return await execute();
    } finally {
      this.decrementActiveInternalSource(source);
    }
  }

  private incrementInFlight(counter: "task" | "event"): void {
    if (counter === "task") {
      this.inFlightTaskCount += 1;
      return;
    }
    this.inFlightEventCount += 1;
  }

  private decrementInFlight(counter: "task" | "event"): void {
    if (counter === "task") {
      this.inFlightTaskCount = Math.max(0, this.inFlightTaskCount - 1);
      return;
    }
    this.inFlightEventCount = Math.max(0, this.inFlightEventCount - 1);
  }

  private getActiveInternalSourceCount(source: RuntimeCallSource): number {
    const count = this.activeInternalSources.get(this.sourceKey(source));
    return count ?? 0;
  }

  private incrementActiveInternalSource(source: RuntimeCallSource): void {
    if (!internalSourceKinds.has(source.kind)) {
      return;
    }

    const key = this.sourceKey(source);
    const current = this.activeInternalSources.get(key) ?? 0;
    this.activeInternalSources.set(key, current + 1);
  }

  private decrementActiveInternalSource(source: RuntimeCallSource): void {
    if (!internalSourceKinds.has(source.kind)) {
      return;
    }

    const key = this.sourceKey(source);
    const current = this.activeInternalSources.get(key);
    if (!current || current <= 1) {
      this.activeInternalSources.delete(key);
      return;
    }

    this.activeInternalSources.set(key, current - 1);
  }

  private sourceKey(source: RuntimeCallSource): string {
    return `${source.kind}:${source.id}`;
  }

  private isBusinessWorkDrained(): boolean {
    return this.inFlightTaskCount === 0 && this.inFlightEventCount === 0;
  }

  private resolveDrainWaitersIfDrained(): void {
    if (!this.isBusinessWorkDrained()) {
      return;
    }

    for (const waiter of Array.from(this.drainWaiters)) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
      this.drainWaiters.delete(waiter);
    }
  }
}
