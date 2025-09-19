import { EJSON } from "@bluelibs/ejson";

export interface Serializer {
  stringify(value: unknown): string;
  parse<T = unknown>(text: string): T;
}

export const EjsonSerializer: Serializer = {
  stringify(value: unknown): string {
    return EJSON.stringify(value);
  },
  parse<T = unknown>(text: string): T {
    return EJSON.parse(text) as T;
  },
};

export function getDefaultSerializer(): Serializer {
  return EjsonSerializer;
}

// Re-export EJSON only (functions are already exported above)
export { EJSON };
