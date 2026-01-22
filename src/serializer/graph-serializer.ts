/**
 * Graph-mode serialization with circular reference handling.
 * Extracted from Serializer.ts as a standalone module.
 */

import type {
  SerializedValue,
  SerializationContext,
  SerializedNode,
} from "./types";
import { isUnsafeKey, assertDepth } from "./validation";
import type { TypeRegistry } from "./type-registry";
import { serializeNonFiniteNumber, serializeUndefined } from "./special-values";

export interface SerializeState {
  serializingValueTypes: WeakSet<object>;
  excludedTypeIds: string[];
}

export interface GraphSerializerOptions {
  maxDepth: number;
  unsafeKeys: ReadonlySet<string>;
  typeRegistry: TypeRegistry;
}

/**
 * Create a unique object ID for the serialization context.
 */
export const createObjectId = (context: SerializationContext): string => {
  context.idCounter += 1;
  return `obj_${context.idCounter}`;
};

/**
 * Store a node in the serialization context.
 */
export const storeNode = (
  context: SerializationContext,
  id: string,
  node: SerializedNode,
): void => {
  context.nodes[id] = node;
  context.nodeCount += 1;
};

/**
 * Serialize a value in graph mode with reference tracking.
 */
export const serializeValue = (
  value: unknown,
  context: SerializationContext,
  state: SerializeState,
  depth: number,
  options: GraphSerializerOptions,
): SerializedValue => {
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

    return value as SerializedValue;
  }

  const objectValue = value as object;

  const existingId = context.objectIds.get(objectValue);
  if (existingId) {
    return { __ref: existingId };
  }

  // Allow value-strategy types to serialize inline without identity tracking.
  const shouldCheckTypes =
    !Array.isArray(objectValue) &&
    !state.serializingValueTypes.has(objectValue);

  if (shouldCheckTypes) {
    const typeDef = options.typeRegistry.findTypeDefinition(
      objectValue,
      state.excludedTypeIds,
    );
    if (typeDef) {
      if (typeDef.strategy === "value") {
        state.serializingValueTypes.add(objectValue);
        const serializedPayload = typeDef.serialize(objectValue);
        const shouldExcludeCurrentType =
          options.typeRegistry.shouldExcludeTypeFromPayload(
            typeDef,
            serializedPayload,
          );
        if (shouldExcludeCurrentType) {
          state.excludedTypeIds.push(typeDef.id);
        }
        try {
          const payload = serializeValue(
            serializedPayload,
            context,
            state,
            depth + 1,
            options,
          );
          // Value types are serialized inline and do not preserve identity
          // This produces stable JSON output for value-like types (ex: Date)
          return {
            __type: typeDef.id,
            value: payload,
          } as SerializedValue;
        } finally {
          state.serializingValueTypes.delete(objectValue);
          if (shouldExcludeCurrentType) {
            state.excludedTypeIds.pop();
          }
        }
      }

      const objectIdForType = createObjectId(context);
      context.objectIds.set(objectValue, objectIdForType);

      const serializedPayload = typeDef.serialize(objectValue);
      const shouldExcludeCurrentType =
        options.typeRegistry.shouldExcludeTypeFromPayload(
          typeDef,
          serializedPayload,
        );
      if (shouldExcludeCurrentType) {
        state.excludedTypeIds.push(typeDef.id);
      }
      try {
        const payload = serializeValue(
          serializedPayload,
          context,
          state,
          depth + 1,
          options,
        );

        storeNode(context, objectIdForType, {
          kind: "type",
          type: typeDef.id,
          value: payload,
        });
        return { __ref: objectIdForType };
      } finally {
        if (shouldExcludeCurrentType) {
          state.excludedTypeIds.pop();
        }
      }
    }
  }

  const objectId = createObjectId(context);
  context.objectIds.set(objectValue, objectId);

  if (Array.isArray(objectValue)) {
    const length = objectValue.length;
    const items: SerializedValue[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      items[index] = serializeValue(
        objectValue[index],
        context,
        state,
        depth + 1,
        options,
      );
    }
    storeNode(context, objectId, { kind: "array", value: items });
    return { __ref: objectId };
  }

  const record: Record<string, SerializedValue> = {};
  const source = objectValue as Record<string, unknown>;
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    if (isUnsafeKey(key, options.unsafeKeys)) {
      continue;
    }
    const entryValue = source[key];
    record[key] = serializeValue(
      entryValue,
      context,
      state,
      depth + 1,
      options,
    );
  }

  storeNode(context, objectId, { kind: "object", value: record });
  return { __ref: objectId };
};
