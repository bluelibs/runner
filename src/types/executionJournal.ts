/**
 * Typed key used to store/retrieve values from an ExecutionJournal.
 * The `id` is used as the storage slot.
 */
declare const journalKeyBrand: unique symbol;

export type JournalKey<T> = {
  /** Stable storage slot id used inside the journal. */
  readonly id: string;
  /** Phantom brand preserving the key's value type in TypeScript. */
  readonly [journalKeyBrand]?: (value: T) => T;
};

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
}
