/**
 * Coordinates manual escalation from graceful shutdown to forced disposal.
 *
 * This controller is intentionally internal: it lets Runner stop waiting at
 * its own shutdown checkpoints without changing public lifecycle signatures.
 */
export class ForceDisposalController {
  private requested = false;
  private resolveRequested!: () => void;
  public readonly whenRequested: Promise<void>;

  constructor() {
    this.whenRequested = new Promise<void>((resolve) => {
      this.resolveRequested = resolve;
    });
  }

  public request(): void {
    if (this.requested) {
      return;
    }

    this.requested = true;
    this.resolveRequested();
  }

  public get isRequested(): boolean {
    return this.requested;
  }
}
