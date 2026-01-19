/**
 * Typed key used to store/retrieve values from an ExecutionJournal.
 * The `id` is used as the storage slot.
 */
declare const journalKeyBrand: unique symbol;

export type JournalKey<T> = {
  readonly id: string;
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
  set<T>(key: JournalKey<T>, value: T, options?: JournalSetOptions): void;
  get<T>(key: JournalKey<T>): T | undefined;
  has<T>(key: JournalKey<T>): boolean;
}
