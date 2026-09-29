import type { ITaskMiddleware } from "../../types/taskMiddleware";

const scopedRuns = new WeakSet<ITaskMiddleware["run"]>();
const identities = new WeakMap<object, string>();

/** Only middleware using distributed policy state needs execution identity tracking. */
export function requireMiddlewareApplicationIdentity(
  middleware: ITaskMiddleware,
): void {
  scopedRuns.add(middleware.run);
}

/** Ordinary middleware keeps its original runner and pays no per-call metadata cost. */
export function scopeMiddlewareApplication(
  middleware: ITaskMiddleware,
  taskId: string,
  middlewareId: string,
  occurrences: Map<string, number>,
): ITaskMiddleware {
  if (!scopedRuns.has(middleware.run)) return middleware;
  // Composition wraps from the inside out; count each definition from that same end.
  const occurrence = occurrences.get(middlewareId) ?? 0;
  occurrences.set(middlewareId, occurrence + 1);
  const identity = JSON.stringify([taskId, middlewareId, occurrence]);
  return {
    ...middleware,
    run(execution, dependencies, config) {
      identities.set(execution, identity);
      return middleware.run(execution, dependencies, config);
    },
  };
}

/** Direct middleware invocations outside the composer retain their task identity. */
export function getMiddlewareApplicationIdentity(
  execution: object,
  taskId: string,
): string {
  return identities.get(execution) ?? taskId;
}
