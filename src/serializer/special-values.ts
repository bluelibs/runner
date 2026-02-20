import { invalidPayloadError, validationError } from "./errors";
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

const BIGINT_PAYLOAD_PATTERN = /^[+-]?\d+$/;

export const assertBigIntPayload = (value: unknown): BigIntPayload => {
  if (typeof value !== "string") {
    throw invalidPayloadError("Invalid bigint payload");
  }
  const normalized = value.trim();
  if (!BIGINT_PAYLOAD_PATTERN.test(normalized)) {
    throw invalidPayloadError("Invalid bigint payload");
  }
  return normalized;
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
    throw validationError("Expected non-finite number");
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
  throw invalidPayloadError("Invalid non-finite number payload");
};
