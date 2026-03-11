import * as utils from "../../define";
import type { Store } from "../Store";

/**
 * Maps a type-guard to its dependency-resolution logic.
 */
export interface DependencyStrategy {
  /** Returns true if this strategy handles the given item. */
  matches: (item: unknown) => boolean;
  /** Returns the store map to check existence against (for optional deps). */
  getStoreMap: (store: Store) => Map<string, unknown>;
}

export const dependencyStrategies: readonly DependencyStrategy[] = [
  {
    matches: utils.isResource,
    getStoreMap: (store) => store.resources as Map<string, unknown>,
  },
  {
    matches: utils.isTask,
    getStoreMap: (store) => store.tasks as Map<string, unknown>,
  },
  {
    matches: utils.isEvent,
    getStoreMap: (store) => store.events as Map<string, unknown>,
  },
  {
    matches: utils.isTag,
    getStoreMap: (store) => store.tags as Map<string, unknown>,
  },
  {
    matches: utils.isError,
    getStoreMap: (store) => store.errors as Map<string, unknown>,
  },
  {
    matches: utils.isAsyncContext,
    getStoreMap: (store) => store.asyncContexts as Map<string, unknown>,
  },
];

/**
 * Find the matching strategy for a dependency item, or undefined if none matches.
 */
export function findDependencyStrategy(
  item: unknown,
): DependencyStrategy | undefined {
  return dependencyStrategies.find((s) => s.matches(item));
}
