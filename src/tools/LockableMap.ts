import { lockableMapLockedError } from "../errors";
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
  #lookupResolver?: (key: K) => K | undefined;

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

  setLookupResolver(resolver: (key: K) => K | undefined): void {
    this.#lookupResolver = resolver;
  }

  /** @throws if the map is locked */
  private throwIfLocked(): void {
    if (this.#locked) {
      lockableMapLockedError.throw({ mapName: this.#name });
    }
  }

  private resolveLookupKey(key: K): K | undefined {
    return this.#lookupResolver?.(key);
  }

  override set(key: K, value: V): this {
    this.throwIfLocked();
    return super.set(key, value);
  }

  override get(key: K): V | undefined {
    if (super.has(key)) {
      return super.get(key);
    }

    const resolvedKey = this.resolveLookupKey(key);
    if (resolvedKey === undefined || Object.is(resolvedKey, key)) {
      return undefined;
    }

    return super.get(resolvedKey);
  }

  override has(key: K): boolean {
    if (super.has(key)) {
      return true;
    }

    const resolvedKey = this.resolveLookupKey(key);
    if (resolvedKey === undefined || Object.is(resolvedKey, key)) {
      return false;
    }

    return super.has(resolvedKey);
  }

  override delete(key: K): boolean {
    this.throwIfLocked();
    if (super.has(key)) {
      return super.delete(key);
    }

    const resolvedKey = this.resolveLookupKey(key);
    if (resolvedKey === undefined || Object.is(resolvedKey, key)) {
      return false;
    }

    return super.delete(resolvedKey);
  }

  deleteExact(key: K): boolean {
    this.throwIfLocked();
    return super.delete(key);
  }

  override clear(): void {
    this.throwIfLocked();
    super.clear();
  }
}
