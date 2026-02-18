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
} from "./types";
import { SymbolPolicy } from "./types";
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

const GRAPH_VERSION = 1;
const DEFAULT_MAX_DEPTH = 1000;
const DEFAULT_MAX_REGEXP_PATTERN_LENGTH = 1024;

function parseJsonPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new SyntaxError("Invalid JSON payload.");
  }
}

export class Serializer {
  /** Type registry for managing custom types */
  private readonly typeRegistry: TypeRegistry;

  private readonly runtimeOptions: {
    maxDepth: number;
    unsafeKeys: ReadonlySet<string>;
    typeRegistry: TypeRegistry;
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
    };
  }

  /**
   * Alias of `serialize()` to match the historical tunnel serializer surface.
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
   * Alias of `deserialize()` to match the historical tunnel serializer surface.
   */
  public parse<T = unknown>(payload: string): T {
    return this.deserialize<T>(payload);
  }

  /**
   * Serialize an arbitrary value into a JSON string.
   */
  public serialize<T>(value: T, context?: SerializationContext): string {
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

    const root = serializeValue(value, ctx, state, 0, this.runtimeOptions);
    if (ctx.nodeCount === 0 && !isObjectReference(root)) {
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
    const parsed = parseJsonPayload(payload);

    if (!isGraphPayload(parsed)) {
      return deserializeLegacy(parsed, 0, this.runtimeOptions) as T;
    }

    const context: DeserializationContext = {
      nodes: toNodeRecord(parsed.nodes, this.unsafeKeys),
      resolved: new Map(),
      resolving: new Set(),
      resolvingRefs: new Set(),
    };

    return deserializeValueFn(
      parsed.root,
      context,
      0,
      this.runtimeOptions,
    ) as T;
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
      throw new TypeError(`Cannot stringify value of type "${type}"`);
    }
    return JSON.stringify(value ?? null, null, this.indent);
  }
}
