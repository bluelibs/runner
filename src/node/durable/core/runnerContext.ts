import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "../../../models/store/Store";
import type { IDurableContext } from "./interfaces/context";

// A Store is owned by one run(app); nested backends share only that run's context stack.
const contexts = new WeakMap<Store, AsyncLocalStorage<IDurableContext>>();

/** @internal Returns the per-Runner execution stack across durable resources. */
export function runnerDurableContext(
  store: Store,
): AsyncLocalStorage<IDurableContext> {
  let context = contexts.get(store);
  if (!context) {
    context = new AsyncLocalStorage<IDurableContext>();
    contexts.set(store, context);
  }
  return context;
}
