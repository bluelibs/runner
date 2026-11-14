import type { IDurableStore } from "../core/interfaces/store";

/** Keeps adapter method bindings and overrides while scoping each asynchronous call. */
export function scopeExecutionStore(
  store: IDurableStore,
  run: <T>(operation: () => T) => T,
): IDurableStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) =>
        run(() => Reflect.apply(member, target, args));
    },
  });
}
