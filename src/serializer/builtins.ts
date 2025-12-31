/**
 * Built-in type definitions for common JavaScript objects
 */

import type { TypeDefinition } from "./types";

/**
 * Built-in type handler for Date objects
 */
export const DateType: TypeDefinition<Date, string> = {
  id: "Date",
  is: (obj: unknown): obj is Date => obj instanceof Date,
  serialize: (date: Date) => date.toISOString(),
  deserialize: (isoString: string) => new Date(isoString),
  create: () => new Date(0),
  strategy: "value",
};

/**
 * Built-in type handler for RegExp objects
 */
export const RegExpType: TypeDefinition<
  RegExp,
  { pattern: string; flags: string }
> = {
  id: "RegExp",
  is: (obj: unknown): obj is RegExp => obj instanceof RegExp,
  serialize: (regex: RegExp) => ({
    pattern: regex.source,
    flags: regex.flags,
  }),
  deserialize: (data: { pattern: string; flags: string }) =>
    new RegExp(data.pattern, data.flags),
  strategy: "value",
};

/**
 * Built-in type handler for Map objects
 */
export const MapType: TypeDefinition<
  Map<unknown, unknown>,
  Array<[unknown, unknown]>
> = {
  id: "Map",
  is: (obj: unknown): obj is Map<unknown, unknown> => obj instanceof Map,
  serialize: (map: Map<unknown, unknown>) => Array.from(map.entries()),
  deserialize: (entries: Array<readonly [unknown, unknown]>) =>
    new Map(entries),
  create: () => new Map<unknown, unknown>(),
};

/**
 * Built-in type handler for Set objects
 */
export const SetType: TypeDefinition<Set<unknown>, unknown[]> = {
  id: "Set",
  is: (obj: unknown): obj is Set<unknown> => obj instanceof Set,
  serialize: (set: Set<unknown>) => Array.from(set.values()),
  deserialize: (values: unknown[]) => new Set(values),
  create: () => new Set<unknown>(),
};

/**
 * Array of all built-in type definitions
 */
export const builtInTypes: Array<TypeDefinition<unknown, unknown>> = [
  DateType as TypeDefinition<unknown, unknown>,
  RegExpType as TypeDefinition<unknown, unknown>,
  MapType as TypeDefinition<unknown, unknown>,
  SetType as TypeDefinition<unknown, unknown>,
];
