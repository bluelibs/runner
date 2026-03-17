import { cancellationError } from "../errors";

/**
 * Encapsulates the bootstrap phase state machine for a single run() invocation.
 *
 * Tracks whether shutdown was requested during bootstrap, whether bootstrap
 * completed, and whether it succeeded — replacing loose variables and closures
 * that were previously scattered inside run().
 */
export class BootstrapCoordinator {
  private shutdownRequested = false;
  private shutdownReason: string | undefined;
  private completed = false;
  private succeededFlag = false;
  private readonly shutdownListeners = new Set<
    (reason: string | undefined) => void
  >();
  private resolveCompletion!: () => void;
  public readonly completion: Promise<void>;

  constructor() {
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  requestShutdown(reason?: string): void {
    this.shutdownRequested = true;
    this.shutdownReason ??= reason;
    for (const listener of this.shutdownListeners) {
      listener(this.shutdownReason);
    }
  }

  /**
   * Runs a bootstrap subphase with a cooperative abort signal that trips as
   * soon as bootstrap shutdown is requested.
   *
   * This keeps long-running subphases signal-aware without pushing the
   * subscription plumbing back into run.ts.
   */
  async withPhaseSignal<T>(
    phase: string,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = (reason: string | undefined) => {
      if (controller.signal.aborted) {
        return;
      }

      controller.abort(
        reason ?? `shutdown requested during bootstrap (${phase})`,
      );
    };
    const unsubscribe = this.subscribeToShutdown(abort);

    if (this.shutdownRequested) {
      abort(this.shutdownReason);
    }

    try {
      return await run(controller.signal);
    } finally {
      unsubscribe();
    }
  }

  /**
   * Throws a cancellation error if shutdown was requested during bootstrap.
   * Called between bootstrap phases to bail out early.
   */
  throwIfShutdownRequested(phase: string): void {
    if (!this.shutdownRequested) {
      return;
    }

    const reason =
      this.shutdownReason !== undefined
        ? `Operation cancelled: ${this.shutdownReason} during bootstrap (${phase}).`
        : `Operation cancelled: shutdown requested during bootstrap (${phase}).`;

    cancellationError.throw({
      reason,
    });
  }

  /**
   * Signals that bootstrap has finished.
   * Must be called exactly once, typically in a finally block.
   */
  markCompleted(succeeded: boolean): void {
    this.succeededFlag = succeeded;
    this.completed = true;
    this.resolveCompletion();
  }

  get wasShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  get succeeded(): boolean {
    return this.succeededFlag;
  }

  private subscribeToShutdown(
    listener: (reason: string | undefined) => void,
  ): () => void {
    this.shutdownListeners.add(listener);
    return () => {
      this.shutdownListeners.delete(listener);
    };
  }
}
