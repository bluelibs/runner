/**
 * Built-in type definitions for common JavaScript objects
 */

import {
  invalidPayloadError,
  validationError,
  unsupportedFeatureError,
} from "./errors";
import type { TypeDefinition } from "./types";
import { binaryBuiltInTypes } from "./binary-builtins";
import { errorAndUrlBuiltInTypes } from "./error-url-builtins";
import {
  assertBigIntPayload,
  assertNonFiniteNumberTag,
  BigIntPayload,
  NonFiniteNumberTag,
  SpecialTypeId,
  getNonFiniteNumberTag,
  serializeBigIntPayload,
} from "./special-values";

export enum SymbolPayloadKind {
  For = "For",
  WellKnown = "WellKnown",
}

const WELL_KNOWN_SYMBOL_KEYS = [
  "asyncIterator",
  "hasInstance",
  "isConcatSpreadable",
  "iterator",
  "match",
  "matchAll",
  // Widely used (ex: RxJS), not part of the standard well-known list.
  // We only support it when the runtime defines Symbol.observable.
  "observable",
  "replace",
  "search",
  "species",
  "split",
  "toPrimitive",
  "toStringTag",
  "unscopables",
] as const;

type WellKnownSymbolKey = (typeof WELL_KNOWN_SYMBOL_KEYS)[number];

export type SerializedSymbolPayload =
  | { kind: SymbolPayloadKind.For; key: string }
  | { kind: SymbolPayloadKind.WellKnown; key: WellKnownSymbolKey };

const getRuntimeWellKnownSymbol = (
  key: WellKnownSymbolKey,
): symbol | undefined => {
  const value = Reflect.get(Symbol, key);
  return typeof value === "symbol" ? value : undefined;
};

const getWellKnownSymbolKey = (value: symbol): WellKnownSymbolKey | null => {
  for (const key of WELL_KNOWN_SYMBOL_KEYS) {
    const runtimeSymbol = getRuntimeWellKnownSymbol(key);
    if (runtimeSymbol === value) {
      return key;
    }
  }
  return null;
};

export const assertSymbolPayload = (
  payload: unknown,
): SerializedSymbolPayload => {
  if (!payload || typeof payload !== "object") {
    throw invalidPayloadError("Invalid symbol payload");
  }
  const rec = payload as Record<string, unknown>;
  if (rec.kind === SymbolPayloadKind.For) {
    if (typeof rec.key !== "string") {
      throw invalidPayloadError("Invalid symbol payload");
    }
    return { kind: SymbolPayloadKind.For, key: rec.key };
  }
  if (rec.kind === SymbolPayloadKind.WellKnown) {
    if (typeof rec.key !== "string") {
      throw invalidPayloadError("Invalid symbol payload");
    }
    if (
      (WELL_KNOWN_SYMBOL_KEYS as readonly string[]).includes(rec.key) === false
    ) {
      throw invalidPayloadError("Invalid symbol payload");
    }
    return {
      kind: SymbolPayloadKind.WellKnown,
      key: rec.key as WellKnownSymbolKey,
    };
  }
  throw invalidPayloadError("Invalid symbol payload");
};

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
  deserialize: (data: { pattern: string; flags: string }) => {
    try {
      return new RegExp(data.pattern, data.flags);
    } catch {
      throw invalidPayloadError("Invalid RegExp payload");
    }
  },
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

export const UndefinedType: TypeDefinition<undefined, null> = {
  id: SpecialTypeId.Undefined,
  is: (obj: unknown): obj is undefined => typeof obj === "undefined",
  serialize: () => null,
  deserialize: () => undefined,
  strategy: "value",
};

export const NonFiniteNumberType: TypeDefinition<number, NonFiniteNumberTag> = {
  id: SpecialTypeId.NonFiniteNumber,
  is: (obj: unknown): obj is number =>
    typeof obj === "number" && !Number.isFinite(obj),
  serialize: (value: number) => {
    const tag = getNonFiniteNumberTag(value);
    if (!tag) {
      throw validationError("Expected non-finite number");
    }
    return tag;
  },
  deserialize: (payload: NonFiniteNumberTag) => {
    const tag = assertNonFiniteNumberTag(payload);
    switch (tag) {
      case NonFiniteNumberTag.NaN:
        return Number.NaN;
      case NonFiniteNumberTag.Infinity:
        return Number.POSITIVE_INFINITY;
      case NonFiniteNumberTag.NegativeInfinity:
        return Number.NEGATIVE_INFINITY;
    }
  },
  strategy: "value",
};

export const BigIntType: TypeDefinition<bigint, BigIntPayload> = {
  id: SpecialTypeId.BigInt,
  is: (obj: unknown): obj is bigint => typeof obj === "bigint",
  serialize: (value: bigint) => serializeBigIntPayload(value),
  deserialize: (value: BigIntPayload) => BigInt(assertBigIntPayload(value)),
  strategy: "value",
};

export const SymbolType: TypeDefinition<symbol, SerializedSymbolPayload> = {
  id: SpecialTypeId.Symbol,
  is: (obj: unknown): obj is symbol => typeof obj === "symbol",
  serialize: (value: symbol) => {
    const forKey = Symbol.keyFor(value);
    if (typeof forKey === "string") {
      return { kind: SymbolPayloadKind.For, key: forKey };
    }
    const wellKnownKey = getWellKnownSymbolKey(value);
    if (wellKnownKey) {
      return { kind: SymbolPayloadKind.WellKnown, key: wellKnownKey };
    }
    throw new TypeError(
      "Cannot serialize unique symbols; use Symbol.for(key) or a well-known symbol like Symbol.iterator",
    );
  },
  deserialize: (payload: SerializedSymbolPayload) => {
    const parsed = assertSymbolPayload(payload);
    if (parsed.kind === SymbolPayloadKind.For) {
      return Symbol.for(parsed.key);
    }
    const value = getRuntimeWellKnownSymbol(parsed.key);
    if (!value) {
      throw unsupportedFeatureError(
        `Unsupported well-known symbol "${parsed.key}"`,
      );
    }
    return value;
  },
  strategy: "value",
};

/**
 * Array of all built-in type definitions
 */
export const builtInTypes: Array<TypeDefinition<unknown, unknown>> = [
  DateType as TypeDefinition<unknown, unknown>,
  RegExpType as TypeDefinition<unknown, unknown>,
  MapType as TypeDefinition<unknown, unknown>,
  SetType as TypeDefinition<unknown, unknown>,
  UndefinedType as TypeDefinition<unknown, unknown>,
  NonFiniteNumberType as TypeDefinition<unknown, unknown>,
  BigIntType as TypeDefinition<unknown, unknown>,
  SymbolType as TypeDefinition<unknown, unknown>,
  ...errorAndUrlBuiltInTypes,
  ...binaryBuiltInTypes,
];
