import {
  ExecutionJournal,
  JournalKey,
  JournalSetOptions,
} from "../types/executionJournal";
import { journalDuplicateKeyError } from "../errors";

/**
 * Implementation of ExecutionJournal.
 * Created per task execution and passed through the middleware chain.
 */
export class ExecutionJournalImpl implements ExecutionJournal {
  private readonly store = new Map<object, unknown>();

  /**
   * Store a value in the journal.
   * Throws an error if the key already exists unless { override: true } is passed.
   */
  set<T>(key: JournalKey<T>, value: T, options?: JournalSetOptions): void {
    if (this.store.has(key) && !options?.override) {
      journalDuplicateKeyError.throw({ keyId: key.id });
    }
    this.store.set(key, value);
  }

  get<T>(key: JournalKey<T>): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  has<T>(key: JournalKey<T>): boolean {
    return this.store.has(key);
  }

  delete<T>(key: JournalKey<T>): void {
    this.store.delete(key);
  }
}

/**
 * Creates a typed journal key for use with ExecutionJournal.
 *
 * @example
 * ```typescript
 * const abortController = journal.createKey<AbortController>("abortController");
 * journal.set(abortController, new AbortController());
 * const ctrl = journal.get(abortController); // AbortController | undefined
 * ```
 */
function createKey<T>(id: string): JournalKey<T> {
  return { id } as JournalKey<T>;
}

/**
 * Factory helpers for creating execution journals and typed journal keys.
 */
export const journal = {
  createKey,
  /**
   * Creates a new empty ExecutionJournal.
   * Useful when you need to pass a specific journal instance to `runTask` or nested calls.
   */
  create: (): ExecutionJournal => new ExecutionJournalImpl(),
};
