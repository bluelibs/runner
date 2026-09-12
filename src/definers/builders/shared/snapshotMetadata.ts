import { isPlainObject } from "../../../tools/typeChecks";

/**
 * Detaches metadata containers before build() freezes them. Opaque instances
 * and functions retain their identity, just as they do in definition metadata.
 */
export function snapshotMetadata<T>(value: T): T {
  return cloneMetadata(value, new WeakMap());
}

function cloneMetadata<T>(value: T, copies: WeakMap<object, object>): T {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return value;
  }

  const original = value as object;
  const existing = copies.get(original);
  if (existing) {
    return existing as T;
  }

  const copy: object = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  copies.set(original, copy);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if ("value" in descriptor) {
      descriptor.value = cloneMetadata(descriptor.value, copies);
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy as T;
}
