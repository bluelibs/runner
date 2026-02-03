import type { SerializedValue } from "./types";

export enum SpecialTypeId {
  Undefined = "Undefined",
  NonFiniteNumber = "NonFiniteNumber",
  BigInt = "BigInt",
  Symbol = "Symbol",
}

export enum NonFiniteNumberTag {
  NaN = "NaN",
  Infinity = "Infinity",
  NegativeInfinity = "-Infinity",
}

export const serializeUndefined = (): SerializedValue => ({
  __type: SpecialTypeId.Undefined,
  value: null,
});

export type BigIntPayload = string;

export const serializeBigIntPayload = (value: bigint): BigIntPayload =>
  value.toString(10);

export const assertBigIntPayload = (value: unknown): BigIntPayload => {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Invalid bigint payload");
};

export const serializeBigInt = (value: bigint): SerializedValue => ({
  __type: SpecialTypeId.BigInt,
  value: serializeBigIntPayload(value),
});

export const getNonFiniteNumberTag = (
  value: number,
): NonFiniteNumberTag | null => {
  if (Number.isNaN(value)) {
    return NonFiniteNumberTag.NaN;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return NonFiniteNumberTag.Infinity;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return NonFiniteNumberTag.NegativeInfinity;
  }
  return null;
};

export const serializeNonFiniteNumber = (value: number): SerializedValue => {
  const tag = getNonFiniteNumberTag(value);
  if (!tag) {
    throw new Error("Expected non-finite number");
  }
  return {
    __type: SpecialTypeId.NonFiniteNumber,
    value: tag,
  };
};

export const assertNonFiniteNumberTag = (
  value: unknown,
): NonFiniteNumberTag => {
  if (
    value === NonFiniteNumberTag.NaN ||
    value === NonFiniteNumberTag.Infinity ||
    value === NonFiniteNumberTag.NegativeInfinity
  ) {
    return value;
  }
  throw new Error("Invalid non-finite number payload");
};
