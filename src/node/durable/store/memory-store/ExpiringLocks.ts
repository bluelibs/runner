type Lock = { id: string; expires: number };

/** Avoid scanning live locks until a recorded expiry can have elapsed. */
export class ExpiringLocks extends Map<string, Lock> {
  private nextExpiry = Infinity;

  override set(resource: string, lock: Lock): this {
    if (lock.expires < this.nextExpiry) this.nextExpiry = lock.expires;
    return super.set(resource, lock);
  }

  prune(now: number): void {
    if (now < this.nextExpiry) return;

    // A renewal or deletion may leave an older lower bound. Rebuild it only
    // once that bound is reached.
    this.nextExpiry = Infinity;
    for (const [resource, lock] of this) {
      if (lock.expires <= now) {
        this.delete(resource);
      } else if (lock.expires < this.nextExpiry) {
        this.nextExpiry = lock.expires;
      }
    }
  }
}
