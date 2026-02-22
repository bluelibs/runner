const isObjectLike = (value: unknown): value is object | Function =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const shouldFreezeRecursively = (value: object | Function): boolean =>
  typeof value === "function" || Array.isArray(value) || isPlainObject(value);

/**
 * Recursively freezes an object graph. Handles cycles via WeakSet.
 */
export function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>(),
  depth = 0,
): T {
  if (!isObjectLike(value)) {
    return value;
  }

  if (depth > 0 && !shouldFreezeRecursively(value)) {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);

  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor) {
      continue;
    }

    if ("value" in descriptor) {
      deepFreeze(descriptor.value, seen, depth + 1);
      continue;
    }

    if (descriptor.get) {
      deepFreeze(descriptor.get, seen, depth + 1);
    }
    if (descriptor.set) {
      deepFreeze(descriptor.set, seen, depth + 1);
    }
  }

  return Object.freeze(objectValue) as T;
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
