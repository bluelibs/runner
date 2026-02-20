/**
 * Validation helpers and type guards for serialization.
 * Extracted from Serializer.ts as a standalone module.
 */

import { depthExceededError } from "./errors";
import type { ObjectReference, SerializedGraph, SerializedNode } from "./types";

/** Default keys to block for prototype pollution protection */
export const DEFAULT_UNSAFE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Check if a key is unsafe (can lead to prototype pollution).
 */
export const isUnsafeKey = (
  key: string,
  unsafeKeys: ReadonlySet<string> = DEFAULT_UNSAFE_KEYS,
): boolean => {
  return unsafeKeys.has(key);
};

/**
 * Check if a value is an object reference (has __ref property).
 */
export const isObjectReference = (value: unknown): value is ObjectReference => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (
    !Object.prototype.hasOwnProperty.call(record, "__ref") ||
    typeof record.__ref !== "string"
  ) {
    return false;
  }

  const ownPropertyNames = Object.getOwnPropertyNames(record);
  if (ownPropertyNames.length !== 1 || ownPropertyNames[0] !== "__ref") {
    return false;
  }

  if (Object.getOwnPropertySymbols(record).length > 0) {
    return false;
  }

  return true;
};

/**
 * Check if a value is a serialized graph payload.
 */
export const isGraphPayload = (value: unknown): value is SerializedGraph => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.__graph !== true) {
    return false;
  }

  if (typeof record.root === "undefined") {
    return false;
  }

  const nodes = record.nodes;
  if (typeof nodes !== "object" || nodes === null) {
    return false;
  }

  return true;
};

/**
 * Check if a value is a serialized type record ({ __type, value }).
 */
export const isSerializedTypeRecord = (
  value: unknown,
): value is { __type: string; value: unknown } => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.__type === "string" &&
    Object.prototype.hasOwnProperty.call(record, "value")
  );
};

/**
 * Convert nodes object to a safe record with null prototype.
 */
export const toNodeRecord = (
  nodes: Record<string, SerializedNode>,
  unsafeKeys: ReadonlySet<string> = DEFAULT_UNSAFE_KEYS,
): Record<string, SerializedNode> => {
  if (!nodes || typeof nodes !== "object") {
    return Object.create(null);
  }
  const record: Record<string, SerializedNode> = Object.create(null);
  for (const key in nodes) {
    if (!Object.prototype.hasOwnProperty.call(nodes, key)) {
      continue;
    }
    if (isUnsafeKey(key, unsafeKeys)) {
      continue;
    }
    record[key] = nodes[key];
  }
  return record;
};

/**
 * Assert that recursion depth is within limits.
 */
export const assertDepth = (depth: number, maxDepth: number): void => {
  if (depth > maxDepth) {
    throw depthExceededError(maxDepth);
  }
};
