import { invalidPayloadError, unsupportedFeatureError } from "./errors";
import type { TypeDefinition } from "./types";

const INVALID_PAYLOAD_MESSAGE_PREFIX = "Invalid";

type TypedArrayTypeId =
  | "Int8Array"
  | "Uint8Array"
  | "Uint8ClampedArray"
  | "Int16Array"
  | "Uint16Array"
  | "Int32Array"
  | "Uint32Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";

const typedArrayTypeIds: TypedArrayTypeId[] = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];

interface RuntimeTypedArrayConstructor {
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBufferLike): ArrayBufferView;
}

interface RuntimeBufferConstructor {
  from(data: readonly number[]): Uint8Array;
  isBuffer(value: unknown): boolean;
}

const getTypedArrayConstructor = (
  typeId: TypedArrayTypeId,
): RuntimeTypedArrayConstructor | null => {
  const value = (globalThis as Record<string, unknown>)[typeId];
  if (typeof value !== "function") {
    return null;
  }
  return value as unknown as RuntimeTypedArrayConstructor;
};

const getRuntimeBufferConstructor = (): RuntimeBufferConstructor | null => {
  const value = (globalThis as Record<string, unknown>).Buffer;
  if (typeof value !== "function") {
    return null;
  }

  const valueRecord = value as unknown as Record<string, unknown>;
  if (
    typeof valueRecord.from !== "function" ||
    typeof valueRecord.isBuffer !== "function"
  ) {
    return null;
  }

  return value as unknown as RuntimeBufferConstructor;
};

const isNodeBuffer = (value: unknown): boolean => {
  const runtimeBufferConstructor = getRuntimeBufferConstructor();
  if (!runtimeBufferConstructor) {
    return false;
  }
  return runtimeBufferConstructor.isBuffer(value);
};

const assertBytePayload = (
  payload: unknown,
  typeId: string,
): readonly number[] => {
  if (!Array.isArray(payload)) {
    throw invalidPayloadError(
      `${INVALID_PAYLOAD_MESSAGE_PREFIX} ${typeId} payload`,
    );
  }

  const bytes: number[] = new Array(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    const byteValue = payload[index];
    if (
      typeof byteValue !== "number" ||
      !Number.isInteger(byteValue) ||
      byteValue < 0 ||
      byteValue > 255
    ) {
      throw invalidPayloadError(
        `${INVALID_PAYLOAD_MESSAGE_PREFIX} ${typeId} payload`,
      );
    }
    bytes[index] = byteValue;
  }
  return bytes;
};

const toBytePayload = (value: ArrayBufferView): readonly number[] =>
  Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

const bytesToArrayBuffer = (payload: unknown, typeId: string): ArrayBuffer => {
  const bytes = assertBytePayload(payload, typeId);
  return Uint8Array.from(bytes).buffer;
};

const deserializeTypedArray = (
  typeId: TypedArrayTypeId,
  payload: unknown,
): ArrayBufferView => {
  const typedArrayConstructor = getTypedArrayConstructor(typeId);
  if (!typedArrayConstructor) {
    throw unsupportedFeatureError(`${typeId} is not available in this runtime`);
  }

  const bytes = assertBytePayload(payload, typeId);
  const bytesPerElement = typedArrayConstructor.BYTES_PER_ELEMENT;
  if (bytes.length % bytesPerElement !== 0) {
    throw invalidPayloadError(
      `${INVALID_PAYLOAD_MESSAGE_PREFIX} ${typeId} payload`,
    );
  }

  const arrayBuffer = Uint8Array.from(bytes).buffer;
  return new typedArrayConstructor(arrayBuffer);
};

const createTypedArrayType = (
  typeId: TypedArrayTypeId,
): TypeDefinition<ArrayBufferView, readonly number[]> => ({
  id: typeId,
  is: (value: unknown): value is ArrayBufferView => {
    const typedArrayConstructor = getTypedArrayConstructor(typeId);
    if (!typedArrayConstructor) {
      return false;
    }
    if (!(value instanceof typedArrayConstructor)) {
      return false;
    }
    if (typeId === "Uint8Array" && isNodeBuffer(value)) {
      return false;
    }
    return true;
  },
  serialize: (value: ArrayBufferView): readonly number[] =>
    toBytePayload(value),
  deserialize: (payload: readonly number[]) =>
    deserializeTypedArray(typeId, payload),
  strategy: "value",
});

export const ArrayBufferType: TypeDefinition<ArrayBuffer, readonly number[]> = {
  id: "ArrayBuffer",
  is: (value: unknown): value is ArrayBuffer => value instanceof ArrayBuffer,
  serialize: (value: ArrayBuffer): readonly number[] =>
    Array.from(new Uint8Array(value)),
  deserialize: (payload: readonly number[]): ArrayBuffer =>
    bytesToArrayBuffer(payload, "ArrayBuffer"),
  strategy: "value",
};

export const DataViewType: TypeDefinition<DataView, readonly number[]> = {
  id: "DataView",
  is: (value: unknown): value is DataView => value instanceof DataView,
  serialize: (value: DataView): readonly number[] => toBytePayload(value),
  deserialize: (payload: readonly number[]): DataView =>
    new DataView(bytesToArrayBuffer(payload, "DataView")),
  strategy: "value",
};

export const BufferType: TypeDefinition<Uint8Array, readonly number[]> = {
  id: "Buffer",
  is: (value: unknown): value is Uint8Array => isNodeBuffer(value),
  serialize: (value: Uint8Array): readonly number[] => toBytePayload(value),
  deserialize: (payload: readonly number[]): Uint8Array => {
    const bytes = assertBytePayload(payload, "Buffer");
    const runtimeBufferConstructor = getRuntimeBufferConstructor();
    if (runtimeBufferConstructor) {
      return runtimeBufferConstructor.from(bytes);
    }
    return Uint8Array.from(bytes);
  },
  strategy: "value",
};

const typedArrayTypes = typedArrayTypeIds.map(
  (typeId) => createTypedArrayType(typeId) as TypeDefinition<unknown, unknown>,
);

export const binaryBuiltInTypes: Array<TypeDefinition<unknown, unknown>> = [
  ArrayBufferType as TypeDefinition<unknown, unknown>,
  DataViewType as TypeDefinition<unknown, unknown>,
  BufferType as TypeDefinition<unknown, unknown>,
  ...typedArrayTypes,
];
