/**
 * Typed key used to store/retrieve values from an ExecutionJournal.
 * The `id` is a stable label exposed to callers for docs and debugging.
 */
declare const journalKeyBrand: unique symbol;

export type JournalKey<T> = {
  /** Stable key label exposed for debugging, docs, and runtime introspection. */
  readonly id: string;
  /** Phantom brand preserving the key's value type in TypeScript. */
  readonly [journalKeyBrand]?: {
    readonly in: (value: T) => void;
    readonly out: () => T;
  };
};

/** Named collection of typed journal keys. */
export type JournalKeyBag = Record<string, JournalKey<any>>;

/**
 * Helper alias used where we want to signal "this must already be a valid
 * journal-key bag" without widening away the bag's exact property names.
 */
export type EnsureJournalKeyBag<TJournalKeys extends JournalKeyBag> =
  TJournalKeys;

/**
 * Options for setting values in the journal.
 */
export interface JournalSetOptions {
  /**
   * If true, allows overwriting an existing value.
   * By default, attempting to set a key that already exists will throw an error.
   */
  override?: boolean;
}

/**
 * Per-execution registry that allows middleware and tasks to share state.
 * A new journal is created for each top-level task execution unless explicitly forwarded.
 */
export interface ExecutionJournal {
  /** Stores a value under the given key. */
  set<T>(key: JournalKey<T>, value: T, options?: JournalSetOptions): void;
  /** Reads a value previously stored for the given key. */
  get<T>(key: JournalKey<T>): T | undefined;
  /** Reports whether a value exists for the given key. */
  has<T>(key: JournalKey<T>): boolean;
  /** Removes any value stored under the given key when supported. */
  delete?<T>(key: JournalKey<T>): void;
}
