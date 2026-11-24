/**
 * Tree-mode serialization without circular reference support.
 * Used by stringify() for simple JSON-compatible output.
 * Extracted from Serializer.ts as a standalone module.
 */

import { genericError } from "../errors";
import { assertDepth, isUnsafeKey } from "./validation";
import type { TypeRegistry } from "./type-registry";
import {
  serializeBigInt,
  serializeNonFiniteNumber,
  serializeUndefined,
} from "./special-values";
import { serializeSymbolValue } from "./serialize-utils";
import { escapeReservedMarkerKey } from "./marker-key-escapes";

const hasOwn = Object.prototype.hasOwnProperty;

export interface TreeSerializeContext {
  stack: WeakSet<object>;
  serializingValueTypes: WeakSet<object>;
  excludedTypeIds: string[];
}

export interface TreeSerializerOptions {
  maxDepth: number;
  unsafeKeys: ReadonlySet<string>;
  typeRegistry: TypeRegistry;
  mapObjectForSerialization?: (value: object) => Record<string, unknown>;
}

const serializeTreeRecord = (
  source: Record<string, unknown>,
  context: TreeSerializeContext,
  nextDepth: number,
  options: TreeSerializerOptions,
): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const key in source) {
    if (!hasOwn.call(source, key)) {
      continue;
    }
    if (isUnsafeKey(key, options.unsafeKeys)) {
      continue;
    }
    const outputKey = escapeReservedMarkerKey(key);
    record[outputKey] = serializeTreeValue(
      source[key],
      context,
      nextDepth,
      options,
    );
  }
  return record;
};

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

    if (valueType === "bigint") {
      return serializeBigInt(value as bigint);
    }

    // Functions are intentionally non-serializable (code execution risk + non-portable).
    if (valueType === "function") {
      throw genericError.new({
        message: `Cannot serialize value of type "${valueType}"`,
      });
    }

    // Symbols are non-JSON primitives; the registry provides safe encodings (Symbol.for + well-known).
    if (valueType === "symbol") {
      return serializeSymbolValue(
        value as symbol,
        context.excludedTypeIds,
        options.typeRegistry,
        (nested) => serializeTreeValue(nested, context, depth + 1, options),
      );
    }

    return value;
  }

  const objectValue = value as object;

  if (context.stack.has(objectValue)) {
    throw genericError.new({
      message: "Cannot serialize circular structure in tree mode",
    });
  }

  context.stack.add(objectValue);

  try {
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
        let shouldExcludeCurrentType = false;
        try {
          const serializedPayload = typeDef.serialize(objectValue);
          shouldExcludeCurrentType =
            options.typeRegistry.shouldExcludeTypeFromPayload(
              typeDef,
              serializedPayload,
            );
          if (shouldExcludeCurrentType) {
            context.excludedTypeIds.push(typeDef.id);
          }
          const payload =
            serializedPayload === objectValue
              ? serializeTreeRecord(
                  options.mapObjectForSerialization
                    ? options.mapObjectForSerialization(objectValue)
                    : (objectValue as Record<string, unknown>),
                  context,
                  depth + 1,
                  options,
                )
              : serializeTreeValue(
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

    if (Array.isArray(objectValue)) {
      const length = objectValue.length;
      const items: unknown[] = new Array(length);
      const nextDepth = depth + 1;
      for (let index = 0; index < length; index += 1) {
        items[index] = serializeTreeValue(
          objectValue[index],
          context,
          nextDepth,
          options,
        );
      }
      return items;
    }

    const recordSource = options.mapObjectForSerialization
      ? options.mapObjectForSerialization(objectValue)
      : (objectValue as Record<string, unknown>);

    return serializeTreeRecord(recordSource, context, depth + 1, options);
  } finally {
    context.stack.delete(objectValue);
  }
};
