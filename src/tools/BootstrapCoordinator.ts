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
  }

  /**
   * Throws a cancellation error if shutdown was requested during bootstrap.
   * Called between bootstrap phases to bail out early.
   */
  throwIfShutdownRequested(phase: string): void {
    if (!this.shutdownRequested) {
      return;
    }

    const reason = this.shutdownReason
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
}
