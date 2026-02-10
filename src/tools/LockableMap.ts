/**
 * A Map that can be permanently locked to prevent further mutations.
 *
 * Before locking it behaves exactly like a regular `Map`.
 * After `lock()` is called, any call to `set`, `delete` or `clear`
 * throws immediately — enforcing immutability at the data-structure level.
 */
export class LockableMap<K, V> extends Map<K, V> {
  #locked = false;
  readonly #name: string;

  constructor(name?: string) {
    super();
    this.#name = name ?? "LockableMap";
  }

  /** Whether the map is currently locked. */
  get locked(): boolean {
    return this.#locked;
  }

  /** Permanently lock the map — no further mutations allowed. */
  lock(): void {
    this.#locked = true;
  }

  /** @throws if the map is locked */
  private throwIfLocked(): void {
    if (this.#locked) {
      throw new Error(`Cannot modify "${this.#name}" — the map is locked.`);
    }
  }

  override set(key: K, value: V): this {
    this.throwIfLocked();
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    this.throwIfLocked();
    return super.delete(key);
  }

  override clear(): void {
    this.throwIfLocked();
    super.clear();
  }
}
