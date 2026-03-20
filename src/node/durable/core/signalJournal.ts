import type { IDurableStore } from "./interfaces/store";
import { durableExecutionInvariantError } from "../../../errors";

export type ISignalJournalStore = IDurableStore & {
  getSignalState: NonNullable<IDurableStore["getSignalState"]>;
  appendSignalRecord: NonNullable<IDurableStore["appendSignalRecord"]>;
  enqueueQueuedSignalRecord: NonNullable<
    IDurableStore["enqueueQueuedSignalRecord"]
  >;
  consumeQueuedSignalRecord: NonNullable<
    IDurableStore["consumeQueuedSignalRecord"]
  >;
};

/**
 * Durable signal journaling is a required capability for signal delivery and
 * consumption. This narrows the store type once so call sites stay small.
 */
export function requireSignalJournalStore(
  store: IDurableStore,
  consumer: "signal()" | "waitForSignal()",
): ISignalJournalStore {
  if (
    !store.getSignalState ||
    !store.appendSignalRecord ||
    !store.enqueueQueuedSignalRecord ||
    !store.consumeQueuedSignalRecord
  ) {
    return durableExecutionInvariantError.throw({
      message: `${consumer} requires a store that implements signal journaling methods`,
    });
  }

  return store as ISignalJournalStore;
}
