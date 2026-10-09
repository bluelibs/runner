import { isPlainObject } from "./typeChecks";

const isObjectLike = (value: unknown): value is object | Function =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const shouldFreezeRecursively = (value: object | Function): boolean =>
  typeof value === "function" || Array.isArray(value) || isPlainObject(value);

// Only successful complete traversals enter this cache. Object.isFrozen alone
// cannot prove that children of a shallow-frozen object are immutable.
const completedGraphs = new WeakSet<object>();

interface FreezeTraversal {
  completed: object[];
  cacheable: boolean;
  hasOpaqueDescendant: boolean;
}

/** Recursively freezes an object graph, preserving cycles and opaque instances. */
export function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>(),
  depth = 0,
): T {
  // Explicit traversal state can exclude descendants, so it cannot prove a
  // complete graph traversal or reuse one completed under different options.
  const traversal: FreezeTraversal = {
    completed: [],
    cacheable: arguments.length <= 1,
    hasOpaqueDescendant: false,
  };
  const result = freezeGraph(value, seen, depth, traversal);
  // A frozen child can still point into an unfinished cycle if the root fails.
  if (traversal.cacheable && !traversal.hasOpaqueDescendant)
    traversal.completed.forEach((object) => completedGraphs.add(object));
  return result;
}

function freezeGraph<T>(
  value: T,
  seen: WeakSet<object>,
  depth: number,
  traversal: FreezeTraversal,
): T {
  if (!isObjectLike(value)) return value;
  if (depth > 0 && !shouldFreezeRecursively(value)) {
    // An opaque instance remains mutable, including its prototype. It can
    // become plain later, so ancestors cannot certify a closed frozen graph.
    traversal.hasOpaqueDescendant = true;
    return value;
  }
  const objectValue = value as object;
  if (
    (traversal.cacheable && completedGraphs.has(objectValue)) ||
    seen.has(objectValue)
  )
    return value;
  seen.add(objectValue);
  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      freezeGraph(descriptor.value, seen, depth + 1, traversal);
      continue;
    }
    if (descriptor.get) freezeGraph(descriptor.get, seen, depth + 1, traversal);
    if (descriptor.set) freezeGraph(descriptor.set, seen, depth + 1, traversal);
  }
  Object.freeze(objectValue);
  traversal.completed.push(objectValue);
  return value;
}

/**
 * Freezes the target only when the source lineage is already locked.
 */
export function freezeIfLineageLocked<TSource, TTarget>(
  source: TSource,
  target: TTarget,
): TTarget {
  if (!isObjectLike(source)) {
    return target;
  }

  if (!Object.isFrozen(source)) {
    return target;
  }

  return deepFreeze(target);
}
