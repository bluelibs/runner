/**
 * Graph-aware serializer/deserializer with circular reference
 * handling and pluggable type support.
 *
 * Internal protocol reference: `readmes/SERIALIZER_PROTOCOL.md`.
 */

import type {
  TypeDefinition,
  SerializationContext,
  SerializerOptions,
  SerializedGraph,
  DeserializationContext,
  SerializerDeserializeOptions,
  SerializerSchemaLike,
  SerializerFieldDecorator,
  SerializerFieldOptions,
} from "./types";
import { SymbolPolicy } from "./types";
import { createMessageError } from "../errors";
import { validationError } from "./errors";
import { check, Match } from "../tools/check";
import { hasClassSchemaMetadata } from "../tools/check/classSchema";
import { TypeRegistry } from "./type-registry";
import {
  isGraphPayload,
  toNodeRecord,
  isObjectReference,
  DEFAULT_UNSAFE_KEYS,
} from "./validation";
import { serializeValue, type SerializeState } from "./graph-serializer";
import { serializeTreeValue } from "./tree-serializer";
import {
  deserializeValue as deserializeValueFn,
  deserializeLegacy,
} from "./deserializer";
import {
  normalizeMaxDepth,
  normalizeMaxRegExpPatternLength,
} from "./option-normalizers";
import {
  remapObjectForSerialization,
  remapValueForSchemaDeserialize,
  type SerializerClassConstructor,
} from "./field-metadata";
import { isClassConstructor } from "../tools/typeChecks";
import { createEsSerializerFieldDecorator } from "./decorators";

const GRAPH_VERSION = 1;
const DEFAULT_MAX_DEPTH = 1000;
const DEFAULT_MAX_REGEXP_PATTERN_LENGTH = 1024;

function parseJsonPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    createMessageError("Invalid JSON payload.");
  }
}

function parseWithSchema<TParsed>(
  value: unknown,
  schema?: unknown,
): TParsed | unknown {
  if (schema === undefined) return value;

  if (typeof schema === "object" && schema !== null && "parse" in schema) {
    const parseFn = (schema as SerializerSchemaLike<TParsed>).parse;
    return parseFn.call(schema, value);
  }

  return check(value, schema as never) as TParsed;
}

function normalizeSchemaOption(schema: unknown): unknown {
  if (schema === undefined) return undefined;

  if (Array.isArray(schema)) {
    if (schema.length !== 1) {
      validationError(
        "Invalid deserialize() schema option: array schemas must contain exactly one element.",
      );
    }

    const elementSchema = normalizeSchemaOption(schema[0]);

    return {
      parse(input: unknown): unknown[] {
        if (!Array.isArray(input)) {
          return check(input, Array);
        }

        return input.map((value) => parseWithSchema(value, elementSchema));
      },
    };
  }

  if (isClassConstructor(schema)) {
    return {
      parse(input: unknown): unknown {
        const remapped = remapValueForSchemaDeserialize(
          input,
          schema as SerializerClassConstructor,
        );

        if (hasClassSchemaMetadata(schema)) {
          return Match.fromSchema(schema as SerializerClassConstructor).parse(
            remapped,
          );
        }

        return check(remapped, schema as never);
      },
    };
  }

  if (typeof schema === "object" && schema !== null && "parse" in schema) {
    const parse = (schema as { parse?: unknown }).parse;
    if (typeof parse !== "function") {
      validationError(
        "Invalid deserialize() schema option: expected an object with a parse(input) function.",
      );
    }
  }

  return schema;
}

export class Serializer {
  public static Field(
    options: SerializerFieldOptions = {},
  ): SerializerFieldDecorator {
    return createEsSerializerFieldDecorator(options);
  }

  /** Type registry for managing custom types */
  private readonly typeRegistry: TypeRegistry;

  private readonly runtimeOptions: {
    maxDepth: number;
    unsafeKeys: ReadonlySet<string>;
    typeRegistry: TypeRegistry;
    mapObjectForSerialization: (value: object) => Record<string, unknown>;
  };

  /** JSON indentation width when pretty printing is enabled */
  private readonly indent: number | undefined;
  /** Maximum recursion depth allowed */
  private readonly maxDepth: number;
  /** Maximum allowed RegExp pattern length during deserialization */
  private readonly maxRegExpPatternLength: number;
  /** Allow RegExp patterns that fail the safety heuristic */
  private readonly allowUnsafeRegExp: boolean;
  /** Disallowed keys that can lead to prototype pollution */
  private readonly unsafeKeys: ReadonlySet<string>;

  constructor(options: SerializerOptions = {}) {
    this.indent = options.pretty ? 2 : undefined;
    this.maxDepth = normalizeMaxDepth(options.maxDepth, DEFAULT_MAX_DEPTH);
    this.maxRegExpPatternLength = normalizeMaxRegExpPatternLength(
      options.maxRegExpPatternLength,
      DEFAULT_MAX_REGEXP_PATTERN_LENGTH,
    );
    this.allowUnsafeRegExp = options.allowUnsafeRegExp ?? false;
    this.unsafeKeys = DEFAULT_UNSAFE_KEYS;

    this.typeRegistry = new TypeRegistry({
      allowedTypes: options.allowedTypes ? new Set(options.allowedTypes) : null,
      regExpValidator: {
        maxPatternLength: this.maxRegExpPatternLength,
        allowUnsafe: this.allowUnsafeRegExp,
      },
      symbolPolicy: options.symbolPolicy ?? SymbolPolicy.AllowAll,
    });

    this.runtimeOptions = {
      maxDepth: this.maxDepth,
      unsafeKeys: this.unsafeKeys,
      typeRegistry: this.typeRegistry,
      mapObjectForSerialization: remapObjectForSerialization,
    };
  }

  /**
   * Alias of `serialize()` to match the historical remote-lane serializer surface.
   */
  public stringify<T>(value: T): string {
    const root = serializeTreeValue(
      value,
      {
        stack: new WeakSet(),
        serializingValueTypes: new WeakSet(),
        excludedTypeIds: [],
      },
      0,
      this.runtimeOptions,
    );
    return this.jsonStringify(root);
  }

  /**
   * Alias of `deserialize()` to match the historical remote-lane serializer surface.
   */
  public parse<TSchemaParsed>(
    payload: string,
    options: { schema: SerializerSchemaLike<TSchemaParsed> },
  ): TSchemaParsed;
  public parse<T = unknown>(
    payload: string,
    options?: SerializerDeserializeOptions,
  ): T;
  public parse<T = unknown>(
    payload: string,
    options?: SerializerDeserializeOptions,
  ): T {
    return this.deserialize<T>(payload, options);
  }

  /**
   * Serialize an arbitrary value into a JSON string.
   */
  public serialize<T>(value: T, context?: SerializationContext): string {
    const serializationContext: SerializationContext = context ?? {
      objectIds: new WeakMap(),
      idCounter: 0,
      nodeCount: 0,
      nodes: Object.create(null),
    };

    const state: SerializeState = {
      serializingValueTypes: new WeakSet(),
      excludedTypeIds: [],
    };

    const root = serializeValue(
      value,
      serializationContext,
      state,
      0,
      this.runtimeOptions,
    );
    if (serializationContext.nodeCount === 0 && !isObjectReference(root)) {
      return this.jsonStringify(root);
    }

    const graph: SerializedGraph = {
      __graph: true,
      version: GRAPH_VERSION,
      root,
      nodes: serializationContext.nodes,
    };

    return this.jsonStringify(graph);
  }

  /**
   * Deserialize a JSON string back to its original value.
   */
  public deserialize<TSchemaParsed>(
    payload: string,
    options: { schema: SerializerSchemaLike<TSchemaParsed> },
  ): TSchemaParsed;
  public deserialize<T = unknown>(
    payload: string,
    options?: SerializerDeserializeOptions,
  ): T;
  public deserialize<T = unknown>(
    payload: string,
    options?: SerializerDeserializeOptions,
  ): T {
    const parsed = parseJsonPayload(payload);
    const schema = normalizeSchemaOption(options?.schema);

    if (!isGraphPayload(parsed)) {
      const deserialized = deserializeLegacy(parsed, 0, this.runtimeOptions);
      return parseWithSchema(deserialized, schema) as T;
    }

    const context: DeserializationContext = {
      nodes: toNodeRecord(parsed.nodes, this.unsafeKeys),
      resolved: new Map(),
      resolving: new Set(),
      resolvingRefs: new Set(),
    };

    const deserialized = deserializeValueFn(
      parsed.root,
      context,
      0,
      this.runtimeOptions,
    );

    return parseWithSchema(deserialized, schema) as T;
  }

  /**
   * Register a custom type for serialization/deserialization.
   */
  public addType<TInstance, TSerialized>(
    typeDef: TypeDefinition<TInstance, TSerialized>,
  ): void {
    this.typeRegistry.addType(typeDef);
  }

  private jsonStringify(value: unknown): string {
    const type = typeof value;
    if (type === "bigint" || type === "symbol" || type === "function") {
      createMessageError(`Cannot stringify value of type "${type}"`);
    }
    return JSON.stringify(value ?? null, null, this.indent);
  }
}
