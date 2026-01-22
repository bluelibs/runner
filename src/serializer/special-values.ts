import type { SerializedValue } from "./types";

export enum SpecialTypeId {
  Undefined = "Undefined",
  NonFiniteNumber = "NonFiniteNumber",
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
