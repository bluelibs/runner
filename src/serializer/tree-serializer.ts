/**
 * Tree-mode serialization without circular reference support.
 * Used by stringify() for simple JSON-compatible output.
 * Extracted from Serializer.ts as a standalone module.
 */

import { isUnsafeKey, assertDepth } from "./validation";
import type { TypeRegistry } from "./type-registry";
import { serializeNonFiniteNumber, serializeUndefined } from "./special-values";

export interface TreeSerializeContext {
  stack: WeakSet<object>;
  serializingValueTypes: WeakSet<object>;
  excludedTypeIds: string[];
}

export interface TreeSerializerOptions {
  maxDepth: number;
  unsafeKeys: ReadonlySet<string>;
  typeRegistry: TypeRegistry;
}

/**
 * Serialize a value in tree mode (throws on circular references).
 */
export const serializeTreeValue = (
  value: unknown,
  context: TreeSerializeContext,
  depth: number,
  options: TreeSerializerOptions,
): unknown => {
  assertDepth(depth, options.maxDepth);
  if (value === null) {
    return null;
  }

  if (typeof value === "undefined") {
    return serializeUndefined();
  }

  const valueType = typeof value;

  if (valueType !== "object") {
    if (valueType === "number") {
      const numericValue = value as number;
      if (!Number.isFinite(numericValue)) {
        return serializeNonFiniteNumber(numericValue);
      }
      return numericValue;
    }

    if (
      valueType === "bigint" ||
      valueType === "symbol" ||
      valueType === "function"
    ) {
      throw new TypeError(`Cannot serialize value of type "${valueType}"`);
    }

    return value;
  }

  const objectValue = value as object;

  if (context.stack.has(objectValue)) {
    throw new TypeError("Cannot serialize circular structure in tree mode");
  }

  const shouldCheckTypes =
    !Array.isArray(objectValue) &&
    !context.serializingValueTypes.has(objectValue);

  if (shouldCheckTypes) {
    const typeDef = options.typeRegistry.findTypeDefinition(
      objectValue,
      context.excludedTypeIds,
    );
    if (typeDef) {
      context.serializingValueTypes.add(objectValue);
      const serializedPayload = typeDef.serialize(objectValue);
      const shouldExcludeCurrentType =
        options.typeRegistry.shouldExcludeTypeFromPayload(
          typeDef,
          serializedPayload,
        );
      try {
        if (shouldExcludeCurrentType) {
          context.excludedTypeIds.push(typeDef.id);
        }
        const payload = serializeTreeValue(
          serializedPayload,
          context,
          depth + 1,
          options,
        );
        return {
          __type: typeDef.id,
          value: payload,
        };
      } finally {
        if (shouldExcludeCurrentType) {
          context.excludedTypeIds.pop();
        }
        context.serializingValueTypes.delete(objectValue);
      }
    }
  }

  context.stack.add(objectValue);

  try {
    if (Array.isArray(objectValue)) {
      const length = objectValue.length;
      const items: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        items[index] = serializeTreeValue(
          objectValue[index],
          context,
          depth + 1,
          options,
        );
      }
      return items;
    }

    const record: Record<string, unknown> = {};
    const source = objectValue as Record<string, unknown>;
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }
      if (isUnsafeKey(key, options.unsafeKeys)) {
        continue;
      }
      const entryValue = source[key];
      record[key] = serializeTreeValue(entryValue, context, depth + 1, options);
    }

    return record;
  } finally {
    context.stack.delete(objectValue);
  }
};
