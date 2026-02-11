/**
 * Tree-mode serialization without circular reference support.
 * Used by stringify() for simple JSON-compatible output.
 * Extracted from Serializer.ts as a standalone module.
 */

import { assertDepth } from "./validation";
import type { TypeRegistry } from "./type-registry";
import {
  serializeBigInt,
  serializeNonFiniteNumber,
  serializeUndefined,
} from "./special-values";
import {
  serializeArrayItems,
  serializeRecordEntries,
  serializeSymbolValue,
} from "./serialize-utils";
import { escapeReservedMarkerKey } from "./marker-key-escapes";

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

    if (valueType === "bigint") {
      return serializeBigInt(value as bigint);
    }

    // Functions are intentionally non-serializable (code execution risk + non-portable).
    if (valueType === "function") {
      throw new TypeError(`Cannot serialize value of type "${valueType}"`);
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
      return serializeArrayItems(objectValue, (nested) =>
        serializeTreeValue(nested, context, depth + 1, options),
      );
    }

    return serializeRecordEntries(
      objectValue as Record<string, unknown>,
      options.unsafeKeys,
      (nested) => serializeTreeValue(nested, context, depth + 1, options),
      escapeReservedMarkerKey,
    );
  } finally {
    context.stack.delete(objectValue);
  }
};
