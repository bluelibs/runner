/**
 * Graph-aware serializer/deserializer with circular reference
 * handling and pluggable type support.
 */

import type {
  TypeDefinition,
  SerializedValue,
  SerializationContext,
  ObjectReference,
  SerializerOptions,
  SerializedGraph,
  DeserializationContext,
  SerializedNode,
} from "./types";
import { builtInTypes } from "./builtins";

const GRAPH_VERSION = 1;

type SerializeState = {
  serializingValueTypes: WeakSet<object>;
  excludedTypeIds: string[];
};

export class Serializer {
  /** Map of registered custom types */
  private readonly typeRegistry = new Map<
    string,
    TypeDefinition<unknown, unknown>
  >();

  /** Map of type identifiers to their definitions */
  private readonly typeMap = new Map<
    string,
    TypeDefinition<unknown, unknown>
  >();

  /** Snapshot array of type definitions used for iteration */
  private typeList: TypeDefinition<unknown, unknown>[] = [];

  /** JSON indentation width when pretty printing is enabled */
  private readonly indent: number | undefined;

  constructor(options: SerializerOptions = {}) {
    this.indent = options.pretty ? 2 : undefined;
    this.registerBuiltInTypes();
    this.refreshTypeCache();
  }

  /**
   * Alias of `serialize()` to match the historical tunnel serializer surface.
   */
  public stringify<T>(value: T): string {
    const root = this.serializeTreeValue(value, {
      stack: new WeakSet(),
      serializingValueTypes: new WeakSet(),
      excludedTypeIds: [],
    });
    return this.jsonStringify(root);
  }

  /**
   * Alias of `deserialize()` to match the historical tunnel serializer surface.
   */
  public parse<T = unknown>(payload: string): T {
    return this.deserialize<T>(payload);
  }

  /**
   * Serialize an arbitrary value into a JSON string.
   */
  public serialize<T>(value: T, context?: SerializationContext): string {
    if (typeof value === "undefined") {
      return "null";
    }

    const ctx: SerializationContext = context ?? {
      objectIds: new WeakMap(),
      idCounter: 0,
      nodeCount: 0,
      nodes: Object.create(null),
    };

    const state: SerializeState = {
      serializingValueTypes: new WeakSet(),
      excludedTypeIds: [],
    };
    const root = this.serializeValue(value, ctx, state);
    if (ctx.nodeCount === 0 && !this.isObjectReference(root)) {
      return this.jsonStringify(root);
    }

    const graph: SerializedGraph = {
      __graph: true,
      version: GRAPH_VERSION,
      root,
      nodes: ctx.nodes,
    };

    return this.jsonStringify(graph);
  }

  /**
   * Deserialize a JSON string back to its original value.
   */
  public deserialize<T = unknown>(payload: string): T {
    const parsed = JSON.parse(payload);

    if (!this.isGraphPayload(parsed)) {
      return this.deserializeLegacy(parsed) as T;
    }

    const context: DeserializationContext = {
      nodes: this.toNodeRecord(parsed.nodes),
      resolved: new Map(),
      resolving: new Set(),
    };

    return this.deserializeValue(parsed.root, context) as T;
  }

  /**
   * Register a custom type for serialization/deserialization.
   */
  public addType<TInstance, TSerialized>(
    typeDef: TypeDefinition<TInstance, TSerialized>,
  ): void;
  public addType<TJson = unknown, TInstance = unknown>(
    name: string,
    factory: (json: TJson) => TInstance,
  ): void;
  public addType<TInstance, TSerialized>(
    arg1: string | TypeDefinition<TInstance, TSerialized>,
    arg2?: (json: unknown) => unknown,
  ): void {
    if (typeof arg1 === "string") {
      const name = arg1;
      const factory = arg2;
      if (!factory) {
        throw new Error(`addType("${name}", factory) requires a factory`);
      }

      type ValueTypeInstance = { typeName(): string; toJSONValue(): unknown };
      const isValueTypeInstance = (obj: unknown): obj is ValueTypeInstance => {
        if (!obj || typeof obj !== "object") return false;
        const rec = obj as Record<string, unknown>;
        return (
          typeof rec.typeName === "function" &&
          typeof rec.toJSONValue === "function"
        );
      };

      this.addType({
        id: name,
        is: (obj: unknown): obj is ValueTypeInstance =>
          isValueTypeInstance(obj) && obj.typeName() === name,
        serialize: (obj: ValueTypeInstance) => obj.toJSONValue(),
        deserialize: (data: unknown) => factory(data),
        strategy: "value",
      });
      return;
    }

    const typeDef = arg1;
    if (!typeDef || !typeDef.id) {
      throw new Error("Invalid type definition: id is required");
    }
    if (!typeDef.serialize || !typeDef.deserialize) {
      throw new Error(
        "Invalid type definition: serialize and deserialize are required",
      );
    }
    if (this.typeRegistry.has(typeDef.id)) {
      throw new Error(`Type with id "${typeDef.id}" already exists`);
    }

    this.typeRegistry.set(
      typeDef.id,
      typeDef as TypeDefinition<unknown, unknown>,
    );
    this.refreshTypeCache();
  }

  private registerBuiltInTypes(): void {
    for (const typeDef of builtInTypes) {
      this.typeRegistry.set(typeDef.id, typeDef);
    }
  }

  private refreshTypeCache(): void {
    this.typeMap.clear();
    const list: TypeDefinition<unknown, unknown>[] = [];
    for (const typeDef of this.typeRegistry.values()) {
      this.typeMap.set(typeDef.id, typeDef);
      list.push(typeDef);
    }
    this.typeList = list;
  }

  private jsonStringify(value: unknown): string {
    const type = typeof value;
    if (type === "bigint" || type === "symbol" || type === "function") {
      throw new TypeError(`Cannot stringify value of type "${type}"`);
    }
    return JSON.stringify(value ?? null, null, this.indent);
  }

  private serializeTreeValue(
    value: unknown,
    context: {
      stack: WeakSet<object>;
      serializingValueTypes: WeakSet<object>;
      excludedTypeIds: string[];
    },
  ): unknown {
    if (value === null) {
      return null;
    }

    if (typeof value === "undefined") {
      return null;
    }

    const valueType = typeof value;

    if (valueType !== "object") {
      if (valueType === "number") {
        const numericValue = value as number;
        return Number.isFinite(numericValue) ? numericValue : null;
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
      const typeDef = this.findTypeDefinition(
        objectValue,
        context.excludedTypeIds,
      );
      if (typeDef) {
        context.serializingValueTypes.add(objectValue);
        const serializedPayload = typeDef.serialize(objectValue);
        const shouldExcludeCurrentType = this.shouldExcludeTypeFromPayload(
          typeDef,
          serializedPayload,
        );
        try {
          if (shouldExcludeCurrentType) {
            context.excludedTypeIds.push(typeDef.id);
          }
          const payload = this.serializeTreeValue(serializedPayload, context);
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
          items[index] = this.serializeTreeValue(objectValue[index], context);
        }
        return items;
      }

      const record: Record<string, unknown> = {};
      const source = objectValue as Record<string, unknown>;
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
          continue;
        }
        const entryValue = source[key];
        if (typeof entryValue === "undefined") {
          continue;
        }
        record[key] = this.serializeTreeValue(entryValue, context);
      }

      return record;
    } finally {
      context.stack.delete(objectValue);
    }
  }

  private createObjectId(context: SerializationContext): string {
    context.idCounter += 1;
    return `obj_${context.idCounter}`;
  }

  private storeNode(
    context: SerializationContext,
    id: string,
    node: SerializedNode,
  ): void {
    context.nodes[id] = node;
    context.nodeCount += 1;
  }

  private serializeValue(
    value: unknown,
    context: SerializationContext,
    state: SerializeState,
  ): SerializedValue {
    if (value === null) {
      return null;
    }

    if (typeof value === "undefined") {
      return null;
    }

    const valueType = typeof value;

    if (valueType !== "object") {
      if (valueType === "number") {
        const numericValue = value as number;
        if (!Number.isFinite(numericValue)) {
          return null;
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
      !Array.isArray(objectValue) && !state.serializingValueTypes.has(objectValue);

    if (shouldCheckTypes) {
      const typeDef = this.findTypeDefinition(objectValue, state.excludedTypeIds);
      if (typeDef) {
        if (typeDef.strategy === "value") {
          state.serializingValueTypes.add(objectValue);
          const serializedPayload = typeDef.serialize(objectValue);
          const shouldExcludeCurrentType = this.shouldExcludeTypeFromPayload(
            typeDef,
            serializedPayload,
          );
          if (shouldExcludeCurrentType) {
            state.excludedTypeIds.push(typeDef.id);
          }
          try {
            const payload = this.serializeValue(serializedPayload, context, state);
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

        const objectIdForType = this.createObjectId(context);
        context.objectIds.set(objectValue, objectIdForType);

        const serializedPayload = typeDef.serialize(objectValue);
        const shouldExcludeCurrentType = this.shouldExcludeTypeFromPayload(
          typeDef,
          serializedPayload,
        );
        if (shouldExcludeCurrentType) {
          state.excludedTypeIds.push(typeDef.id);
        }
        try {
          const payload = this.serializeValue(serializedPayload, context, state);

          this.storeNode(context, objectIdForType, {
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

    const objectId = this.createObjectId(context);
    context.objectIds.set(objectValue, objectId);

    if (Array.isArray(objectValue)) {
      const length = objectValue.length;
      const items: SerializedValue[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        items[index] = this.serializeValue(objectValue[index], context, state);
      }
      this.storeNode(context, objectId, { kind: "array", value: items });
      return { __ref: objectId };
    }

    const record: Record<string, SerializedValue> = {};
    const source = objectValue as Record<string, unknown>;
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }
      const entryValue = source[key];
      if (typeof entryValue === "undefined") {
        continue;
      }
      record[key] = this.serializeValue(entryValue, context, state);
    }

    this.storeNode(context, objectId, { kind: "object", value: record });
    return { __ref: objectId };
  }

  private findTypeDefinition(
    value: unknown,
    excludedTypeIds: readonly string[],
  ): TypeDefinition<unknown, unknown> | undefined {
    for (const typeDef of this.typeList) {
      if (excludedTypeIds.includes(typeDef.id)) {
        continue;
      }
      try {
        if (typeDef.is(value)) {
          return typeDef;
        }
      } catch {
        // Type guard threw an error; skip this type definition
        continue;
      }
    }
    return undefined;
  }

  private shouldExcludeTypeFromPayload(
    typeDef: TypeDefinition<unknown, unknown>,
    serializedPayload: unknown,
  ): boolean {
    try {
      return typeDef.is(serializedPayload);
    } catch {
      return false;
    }
  }
  // ... (skipping unchanged methods)

  private isObjectReference(value: unknown): value is ObjectReference {
    return Boolean(
      value &&
      typeof value === "object" &&
      value !== null &&
      "__ref" in value &&
      typeof (value as Record<"__ref", unknown>).__ref === "string",
    );
  }

  private isGraphPayload(value: unknown): value is SerializedGraph {
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
  }

  private toNodeRecord(
    nodes: Record<string, SerializedNode>,
  ): Record<string, SerializedNode> {
    if (!nodes || typeof nodes !== "object") {
      return Object.create(null);
    }
    return nodes;
  }

  private deserializeValue(
    value: SerializedValue,
    context: DeserializationContext,
  ): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      const length = value.length;
      const result: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        result[index] = this.deserializeValue(value[index], context);
      }
      return result;
    }

    if (this.isObjectReference(value)) {
      return this.resolveReference(value.__ref, context);
    }

    if (this.isSerializedTypeRecord(value)) {
      const typeDef = this.typeMap.get(value.__type);
      if (!typeDef) {
        throw new Error(`Unknown type: ${value.__type}`);
      }
      const data = this.deserializeValue(
        value.value as SerializedValue,
        context,
      );
      return typeDef.deserialize(data);
    }

    const obj: Record<string, unknown> = {};
    const source = value as Record<string, SerializedValue>;
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        continue;
      }
      obj[key] = this.deserializeValue(source[key], context);
    }
    return obj;
  }

  private resolveReference(
    id: string,
    context: DeserializationContext,
  ): unknown {
    if (context.resolved.has(id)) {
      return context.resolved.get(id);
    }

    const node = context.nodes[id];
    if (!node) {
      throw new Error(`Unresolved reference id "${id}"`);
    }

    switch (node.kind) {
      case "array": {
        const values = node.value;
        const arr: unknown[] = new Array(values.length);
        context.resolved.set(id, arr);
        for (let index = 0; index < values.length; index += 1) {
          arr[index] = this.deserializeValue(values[index], context);
        }
        return arr;
      }

      case "object": {
        const target: Record<string, unknown> = {};
        context.resolved.set(id, target);
        const source = node.value;
        for (const key in source) {
          if (!Object.prototype.hasOwnProperty.call(source, key)) {
            continue;
          }
          target[key] = this.deserializeValue(source[key], context);
        }
        return target;
      }

      case "type": {
        const typeDef = this.typeMap.get(node.type);
        if (!typeDef) {
          throw new Error(`Unknown type: ${node.type}`);
        }

        const createdPlaceholder =
          typeof typeDef.create === "function" ? typeDef.create() : undefined;
        const hasFactory =
          createdPlaceholder !== undefined && createdPlaceholder !== null;
        const placeholder: unknown = hasFactory
          ? createdPlaceholder
          : Object.create(null);
        context.resolved.set(id, placeholder);
        context.resolving.add(id);

        const deserializedPayload = this.deserializeValue(node.value, context);
        const result = typeDef.deserialize(deserializedPayload);
        const finalResult = hasFactory
          ? this.mergePlaceholder(placeholder, result)
          : result;

        context.resolved.set(id, finalResult);
        context.resolving.delete(id);
        return finalResult;
      }

      default: {
        throw new Error("Unsupported node kind");
      }
    }
  }

  private mergePlaceholder(placeholder: unknown, result: unknown): unknown {
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
      Object.assign(
        placeholder as Record<string, unknown>,
        result as Record<string, unknown>,
      );
      return placeholder;
    }

    return result;
  }

  private deserializeLegacy(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.deserializeLegacy(item));
    }

    if (this.isSerializedTypeRecord(value)) {
      const typeDef = this.typeMap.get(value.__type);
      if (!typeDef) {
        throw new Error(`Unknown type: ${value.__type}`);
      }
      const data = this.deserializeLegacy(value.value);
      return typeDef.deserialize(data);
    }

    const obj: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      obj[key] = this.deserializeLegacy(entry);
    }
    return obj;
  }

  private isSerializedTypeRecord(
    value: unknown,
  ): value is { __type: string; value: unknown } {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.__type === "string" &&
      Object.prototype.hasOwnProperty.call(record, "value")
    );
  }
}
