/**
 * Public serializer entrypoint used by transport, persistence, and async-context integrations.
 */

export type {
  JsonPrimitive,
  ObjectReference,
  SerializedTypeRecord,
  SerializerOptions,
  TypeDefinition,
  SerializedNode,
  SerializedValue,
  SerializationContext,
  DeserializationContext,
  SerializedGraph,
  SerializerLike,
  SerializerSchemaLike,
  SerializerDeserializeOptions,
  SerializerFieldOptions,
  SerializerFieldDecorator,
} from "./types";

/**
 * Symbol handling policies for values that are not JSON-native.
 */
export { SymbolPolicy, SymbolPolicyErrorMessage } from "./types";
/**
 * Graph-aware serializer that preserves shared references across complex object trees.
 */
export { Serializer } from "./Serializer";
