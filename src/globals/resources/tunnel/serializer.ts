import { EJSON } from "@bluelibs/ejson";
import { Serializer as GraphSerializer } from "../../../serializer";

/**
 * Tunnel-facing serializer wrapper backed by a single GraphSerializer instance.
 * Consumers should call `getDefaultSerializer()` or inject the serializer
 * resource; reach for the raw `EJSON` only for legacy interop.
 */

export interface Serializer {
  stringify(value: unknown): string;
  parse<T = unknown>(text: string): T;
  addType?<TJson = unknown, T = unknown>(
    name: string,
    factory: (json: TJson) => T,
  ): void;
}

// Singleton GraphSerializer instance for the entire application
const graphSerializer = new GraphSerializer();

/**
 * Default serializer using GraphSerializer.
 * Supports circular references, shared object identity, and all EJSON types.
 */
export const serializer: Serializer = {
  stringify(value: unknown): string {
    return graphSerializer.serialize(value);
  },
  parse<T = unknown>(text: string): T {
    return graphSerializer.deserialize(text);
  },
  addType<TJson = unknown, T = unknown>(
    name: string,
    factory: (json: TJson) => T,
  ): void {
    // Register with GraphSerializer using EJSON-style pattern
    graphSerializer.addType({
      id: name,
      is: (obj: unknown): obj is T =>
        Boolean(
          obj &&
            typeof obj === "object" &&
            typeof (obj as any).typeName === "function" &&
            (obj as any).typeName() === name,
        ),
      serialize: (obj: any) => obj.toJSONValue(),
      deserialize: factory,
      strategy: "value", // Use inline serialization for EJSON-style types
    });
    // Also register with EJSON for backward compatibility
    EJSON.addType(name, factory as (json: any) => T);
  },
};

export function getDefaultSerializer(): Serializer {
  return serializer;
}

// Re-export EJSON for users who need raw access
export { EJSON };
