import { validationError } from "../../errors";
import type { SerializerLike } from "../../serializer";

export function serializeLiveValue(
  value: unknown,
  serializer: SerializerLike,
): string {
  const payload = serializer.stringify(value);
  assertBsonRoundTrip(value, serializer.parse(payload));
  return payload;
}

export function cloneLiveValue<T>(value: T, serializer: SerializerLike): T {
  const payload = serializer.stringify(value);
  const roundTripped = serializer.parse<T>(payload);
  assertBsonRoundTrip(value, roundTripped);
  return roundTripped;
}

function assertBsonRoundTrip(source: unknown, roundTripped: unknown): void {
  if (
    containsBsonValue(source) &&
    !sameBsonConstructors(source, roundTripped)
  ) {
    validationError.throw({
      subject: "Live data serialization",
      id: "liveData",
      originalError:
        "BSON values must be registered with resources.serializer before they are used in live query inputs, contexts, or results.",
    });
  }
}

function containsBsonValue(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (typeof (value as { _bsontype?: unknown })._bsontype === "string") {
    return true;
  }
  if (value instanceof Map) {
    return [...value].some(
      ([key, child]) =>
        containsBsonValue(key, seen) || containsBsonValue(child, seen),
    );
  }
  if (value instanceof Set) {
    return [...value].some((child) => containsBsonValue(child, seen));
  }
  return Object.values(value).some((child) => containsBsonValue(child, seen));
}

function sameBsonConstructors(
  source: unknown,
  target: unknown,
  seen = new Map<object, Set<object>>(),
): boolean {
  if (!source || typeof source !== "object") return true;
  const bsonType = (source as { _bsontype?: unknown })._bsontype;
  if (typeof bsonType === "string") {
    return (
      !!target &&
      typeof target === "object" &&
      (target as { _bsontype?: unknown })._bsontype === bsonType &&
      (target as object).constructor === (source as object).constructor
    );
  }
  if (!target || typeof target !== "object") return false;
  const seenTargets = seen.get(source);
  if (seenTargets?.has(target)) return true;
  if (seenTargets) {
    seenTargets.add(target);
  } else {
    seen.set(source, new Set([target]));
  }
  if (Array.isArray(source)) {
    return (
      Array.isArray(target) &&
      source.every((child, index) =>
        sameBsonConstructors(child, target[index], seen),
      )
    );
  }
  if (source instanceof Map) {
    if (!(target instanceof Map) || source.size !== target.size) return false;
    const targetEntries = [...target];
    return [...source].every(
      ([key, child], index) =>
        sameBsonConstructors(key, targetEntries[index][0], seen) &&
        sameBsonConstructors(child, targetEntries[index][1], seen),
    );
  }
  if (source instanceof Set) {
    if (!(target instanceof Set) || source.size !== target.size) return false;
    const targetValues = [...target];
    return [...source].every((child, index) =>
      sameBsonConstructors(child, targetValues[index], seen),
    );
  }
  return Object.entries(source).every(([key, child]) =>
    sameBsonConstructors(child, (target as Record<string, unknown>)[key], seen),
  );
}
