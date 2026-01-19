import { ExecutionJournal, JournalKey } from "../types/executionJournal";

/**
 * Implementation of ExecutionJournal.
 * Created per task execution and passed through the middleware chain.
 */
export class ExecutionJournalImpl implements ExecutionJournal {
  private readonly store = new Map<string, unknown>();

  set<T>(key: JournalKey<T>, value: T): void {
    this.store.set(key.id, value);
  }

  get<T>(key: JournalKey<T>): T | undefined {
    return this.store.get(key.id) as T | undefined;
  }

  has<T>(key: JournalKey<T>): boolean {
    return this.store.has(key.id);
  }
}

/**
 * Creates a typed journal key for use with ExecutionJournal.
 *
 * @example
 * ```typescript
 * const abortController = journal.createKey<AbortController>("timeout.abortController");
 * journal.set(abortController, new AbortController());
 * const ctrl = journal.get(abortController); // AbortController | undefined
 * ```
 */
function createKey<T>(id: string): JournalKey<T> {
  return { id } as JournalKey<T>;
}

export const journal = {
  createKey,
  /**
   * Creates a new empty ExecutionJournal.
   * Useful when you need to pass a specific journal instance to `runTask` or nested calls.
   */
  create: () => new ExecutionJournalImpl(),
};
