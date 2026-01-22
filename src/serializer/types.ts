/**
 * Type definitions for the Serializer class
 */

/**
 * Definition for a custom type that can be serialized/deserialized
 */
export interface TypeDefinition<TInstance = unknown, TSerialized = unknown> {
  /** Unique identifier for the type */
  id: string;
  /** Predicate function to check if an object matches this type */
  is: (obj: unknown) => obj is TInstance;
  /** Function to serialize the object */
  serialize: (obj: TInstance) => TSerialized;
  /** Function to deserialize the data back to the original object */
  deserialize: (data: TSerialized) => TInstance;
  /** Optional factory used to create a placeholder during deserialization */
  create?: () => TInstance;
  /** Serialization strategy: 'value' (inline, no identity) or 'ref' (graph node, identity preserved). Default: 'ref' */
  strategy?: "value" | "ref";
}

/** Reference to another object in the serialization */
export interface ObjectReference {
  /** Reference to object ID */
  __ref: string;
}

/**
 * Discriminated union describing the serialized graph payload.
 * Each node captures either an array, plain object, or typed payload.
 */
export type SerializedNode =
  | { kind: "array"; value: SerializedValue[] }
  | { kind: "object"; value: Record<string, SerializedValue> }
  | { kind: "type"; type: string; value: SerializedValue };

/**
 * Serialization context for tracking object references
 */
export interface SerializationContext {
  /** Map of objects to their IDs */
  objectIds: WeakMap<object, string>;
  /** Counter for generating unique IDs */
  idCounter: number;
  /** Number of graph nodes recorded */
  nodeCount: number;
  /** Nodes collected during serialization (id -> serialized node) */
  nodes: Record<string, SerializedNode>;
}

/**
 * Deserialization context used when materialising a graph payload.
 */
export interface DeserializationContext {
  nodes: Record<string, SerializedNode>;
  resolved: Map<string, unknown>;
  resolving: Set<string>;
  /**
   * Tracks reference ids that were requested while still being resolved.
   * Used to detect circular references that rely on placeholders.
   */
  resolvingRefs: Set<string>;
}

/**
 * Union type for serialized values
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SerializedTypeRecord {
  __type: string;
  value: SerializedValue;
}
export type SerializedValue =
  | JsonPrimitive
  | ObjectReference
  | SerializedTypeRecord
  | SerializedValue[]
  | { [key: string]: SerializedValue };

/**
 * Envelope saved to disk/wire when serialising a graph payload.
 */
export interface SerializedGraph {
  __graph: true;
  version: number;
  root: SerializedValue;
  nodes: Record<string, SerializedNode>;
}

export enum SymbolPolicy {
  AllowAll = "AllowAll",
  WellKnownOnly = "WellKnownOnly",
  Disabled = "Disabled",
}

export enum SymbolPolicyErrorMessage {
  GlobalSymbolsNotAllowed = "Global symbols are not allowed",
  SymbolsNotAllowed = "Symbols are not allowed",
  UnsupportedSymbolPolicy = "Unsupported symbol policy",
}

/**
 * Main serializer options
 */
export interface SerializerOptions {
  /** Whether to pretty-print JSON (for debugging) */
  pretty?: boolean;
  /** Maximum recursion depth allowed during serialize/deserialize */
  maxDepth?: number;
  /** Restrict deserialization to this list of type IDs */
  allowedTypes?: readonly string[];
  /** Controls which Symbol payloads may be deserialized */
  symbolPolicy?: SymbolPolicy;
  /** Maximum accepted RegExp pattern length during deserialization */
  maxRegExpPatternLength?: number;
  /** Allow RegExp patterns that fail the safety heuristic */
  allowUnsafeRegExp?: boolean;
}

/**
 * Minimal serializer contract used across transports and persistence.
 * Implementations must be able to round-trip JSON-compatible payloads and
 * should support custom value types via `addType`.
 */
export interface SerializerLike {
  stringify(value: unknown): string;
  parse<T = unknown>(text: string): T;
  addType?<TJson = unknown, TInstance = unknown>(
    name: string,
    factory: (json: TJson) => TInstance,
  ): void;
}
