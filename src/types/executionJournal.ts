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
 * Per-execution registry that allows middleware and tasks to share state.
 * A new journal is created for each top-level task execution unless explicitly forwarded.
 */
export interface ExecutionJournal {
  set<T>(key: JournalKey<T>, value: T): void;
  get<T>(key: JournalKey<T>): T | undefined;
  has<T>(key: JournalKey<T>): boolean;
}
