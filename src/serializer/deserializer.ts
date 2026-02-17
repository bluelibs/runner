/**
 * Deserialization logic for graph and legacy payloads.
 * Extracted from Serializer.ts as a standalone module.
 */

import {
  invalidPayloadError,
  referenceResolutionError,
  validationError,
} from "./errors";
import type { SerializedValue, DeserializationContext } from "./types";
import {
  isObjectReference,
  isSerializedTypeRecord,
  isUnsafeKey,
  assertDepth,
} from "./validation";
import type { TypeRegistry } from "./type-registry";
import { unescapeReservedMarkerKey } from "./marker-key-escapes";

const hasOwn = Object.prototype.hasOwnProperty;

export interface DeserializerOptions {
  maxDepth: number;
  unsafeKeys: ReadonlySet<string>;
  typeRegistry: TypeRegistry;
}

const copyOwnProperties = (
  target: object,
  source: object,
  unsafeKeys: ReadonlySet<string>,
): void => {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const key of Object.keys(descriptors)) {
    if (isUnsafeKey(key, unsafeKeys)) {
      continue;
    }
    Object.defineProperty(target, key, descriptors[key]);
  }

  const symbols = Object.getOwnPropertySymbols(source);
  for (const symbol of symbols) {
    const descriptor = Object.getOwnPropertyDescriptor(source, symbol);
    if (!descriptor) {
      continue;
    }
    Object.defineProperty(target, symbol, descriptor);
  }
};

const mergeTypePlaceholderWithoutFactory = (
  placeholder: unknown,
  result: unknown,
  unsafeKeys: ReadonlySet<string>,
  hasCircularReference: boolean,
): unknown => {
  if (placeholder === result) {
    return result;
  }

  if (result === null || typeof result !== "object") {
    if (hasCircularReference) {
      throw validationError(
        "Cannot preserve circular references for a type without create() that deserializes to a non-object value",
      );
    }
    return result;
  }

  // Arrays and objects with internal slots cannot be reconstructed by mutating
  // a plain placeholder object. Require create() in those cases if identity is needed.
  if (
    Array.isArray(result) ||
    result instanceof Map ||
    result instanceof Set ||
    result instanceof Date ||
    result instanceof RegExp
  ) {
    if (hasCircularReference) {
      throw validationError(
        "Cannot preserve circular references for a type without create(); provide create() for identity-safe placeholders",
      );
    }
    return result;
  }

  const target = placeholder as object;
  const source = result as object;

  const sourcePrototype = Object.getPrototypeOf(source);
  if (Object.getPrototypeOf(target) !== sourcePrototype) {
    Object.setPrototypeOf(target, sourcePrototype);
  }

  copyOwnProperties(target, source, unsafeKeys);
  return target;
};

/**
 * Deserialize a value from its serialized representation.
 */
export const deserializeValue = (
  value: SerializedValue,
  context: DeserializationContext,
  depth: number,
  options: DeserializerOptions,
): unknown => {
  assertDepth(depth, options.maxDepth);
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const length = value.length;
    const result: unknown[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = deserializeValue(
        value[index],
        context,
        depth + 1,
        options,
      );
    }
    return result;
  }

  if (hasOwn.call(value, "__ref")) {
    if (!isObjectReference(value)) {
      throw invalidPayloadError("Invalid object reference payload");
    }
    return resolveReference(value.__ref, context, depth + 1, options);
  }

  if (isSerializedTypeRecord(value)) {
    const typeDef = options.typeRegistry.getTypeDefinition(value.__type);
    const data = deserializeValue(
      value.value as SerializedValue,
      context,
      depth + 1,
      options,
    );
    return options.typeRegistry.deserializeType(typeDef, value.__type, data);
  }

  const obj: Record<string, unknown> = {};
  const source = value as Record<string, SerializedValue>;
  for (const key in source) {
    if (!hasOwn.call(source, key)) {
      continue;
    }
    if (isUnsafeKey(key, options.unsafeKeys)) {
      continue;
    }
    obj[key] = deserializeValue(source[key], context, depth + 1, options);
  }
  return obj;
};

/**
 * Resolve a reference ID to its deserialized value.
 */
export const resolveReference = (
  id: string,
  context: DeserializationContext,
  depth: number,
  options: DeserializerOptions,
): unknown => {
  assertDepth(depth, options.maxDepth);
  if (isUnsafeKey(id, options.unsafeKeys)) {
    throw referenceResolutionError(`Unresolved reference id "${id}"`);
  }
  if (context.resolved.has(id)) {
    if (context.resolving.has(id)) {
      context.resolvingRefs.add(id);
    }
    return context.resolved.get(id);
  }

  const node = context.nodes[id];
  if (!node) {
    throw referenceResolutionError(`Unresolved reference id "${id}"`);
  }

  switch (node.kind) {
    case "array": {
      const values = node.value;
      if (!Array.isArray(values)) {
        throw invalidPayloadError("Invalid array node payload");
      }
      const arr: unknown[] = new Array(values.length);
      context.resolved.set(id, arr);
      for (let index = 0; index < values.length; index += 1) {
        arr[index] = deserializeValue(
          values[index],
          context,
          depth + 1,
          options,
        );
      }
      return arr;
    }

    case "object": {
      const source = node.value;
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw invalidPayloadError("Invalid object node payload");
      }

      const target: Record<string, unknown> = {};
      context.resolved.set(id, target);
      for (const key in source) {
        if (!hasOwn.call(source, key)) {
          continue;
        }
        if (isUnsafeKey(key, options.unsafeKeys)) {
          continue;
        }
        target[key] = deserializeValue(
          source[key],
          context,
          depth + 1,
          options,
        );
      }
      return target;
    }

    case "type": {
      const typeDef = options.typeRegistry.getTypeDefinition(node.type);

      const createdPlaceholder =
        typeof typeDef.create === "function" ? typeDef.create() : undefined;
      const hasFactory =
        createdPlaceholder !== undefined && createdPlaceholder !== null;
      const placeholder: unknown = hasFactory
        ? createdPlaceholder
        : Object.create(null);
      context.resolved.set(id, placeholder);
      context.resolving.add(id);

      const deserializedPayload = deserializeValue(
        node.value,
        context,
        depth + 1,
        options,
      );
      const result = options.typeRegistry.deserializeType(
        typeDef,
        node.type,
        deserializedPayload,
      );
      const finalResult = hasFactory
        ? mergePlaceholder(placeholder, result, options.unsafeKeys)
        : mergeTypePlaceholderWithoutFactory(
            placeholder,
            result,
            options.unsafeKeys,
            context.resolvingRefs.has(id),
          );

      context.resolved.set(id, finalResult);
      context.resolving.delete(id);
      return finalResult;
    }

    default: {
      throw validationError("Unsupported node kind");
    }
  }
};

/**
 * Merge a placeholder with the final result for identity preservation.
 */
export const mergePlaceholder = (
  placeholder: unknown,
  result: unknown,
  unsafeKeys: ReadonlySet<string>,
): unknown => {
  if (placeholder === result) {
    return result;
  }

  if (placeholder instanceof Map && result instanceof Map) {
    placeholder.clear();
    for (const [key, value] of result.entries()) {
      placeholder.set(key, value);
    }
    return placeholder;
  }

  if (placeholder instanceof Set && result instanceof Set) {
    placeholder.clear();
    result.forEach((value) => placeholder.add(value));
    return placeholder;
  }

  if (placeholder instanceof Date && result instanceof Date) {
    placeholder.setTime(result.getTime());
    return placeholder;
  }

  if (
    placeholder !== null &&
    typeof placeholder === "object" &&
    result !== null &&
    typeof result === "object"
  ) {
    const target = placeholder as Record<string, unknown>;
    const source = result as Record<string, unknown>;
    for (const key in source) {
      if (!hasOwn.call(source, key)) {
        continue;
      }
      if (isUnsafeKey(key, unsafeKeys)) {
        continue;
      }
      target[key] = source[key];
    }
    return placeholder;
  }

  return result;
};

/**
 * Deserialize legacy tree-format payloads (pre-graph format).
 */
export const deserializeLegacy = (
  value: unknown,
  depth: number,
  options: DeserializerOptions,
): unknown => {
  assertDepth(depth, options.maxDepth);
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const length = value.length;
    const result: unknown[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = deserializeLegacy(value[index], depth + 1, options);
    }
    return result;
  }

  if (isSerializedTypeRecord(value)) {
    const typeDef = options.typeRegistry.getTypeDefinition(value.__type);
    const data = deserializeLegacy(value.value, depth + 1, options);
    return options.typeRegistry.deserializeType(typeDef, value.__type, data);
  }

  const obj: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const rawKey in source) {
    if (!hasOwn.call(source, rawKey)) {
      continue;
    }
    const key = unescapeReservedMarkerKey(rawKey);
    if (isUnsafeKey(key, options.unsafeKeys)) {
      continue;
    }
    obj[key] = deserializeLegacy(source[rawKey], depth + 1, options);
  }
  return obj;
};
