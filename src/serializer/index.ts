/**
 * Main export module for the Serializer
 */

import { Serializer } from "./Serializer";

export type {
  SerializerOptions,
  TypeDefinition,
  SerializedGraph,
  SerializerLike,
} from "./types";

export { Serializer } from "./Serializer";

const defaultSerializer = new Serializer();

export function getDefaultSerializer(): Serializer {
  return defaultSerializer;
}
