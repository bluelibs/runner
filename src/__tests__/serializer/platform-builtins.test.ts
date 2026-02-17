import { describe, it, expect } from "@jest/globals";
import { Serializer } from "../../serializer";
import { createMessageError } from "../../errors";

type RuntimeBufferConstructor = {
  from(data: readonly number[]): Uint8Array;
  isBuffer(value: unknown): boolean;
};

type TypedArrayFactory = {
  typeId: string;
  create: () => ArrayBufferView;
};

const toBytePayload = (value: ArrayBufferView): readonly number[] =>
  Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

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

const createTypedArrayFactories = (): TypedArrayFactory[] => {
  const factories: TypedArrayFactory[] = [
    { typeId: "Int8Array", create: () => new Int8Array([-3, -2, -1, 0, 1]) },
    { typeId: "Uint8Array", create: () => new Uint8Array([0, 1, 255]) },
    {
      typeId: "Uint8ClampedArray",
      create: () => new Uint8ClampedArray([0, 128, 255]),
    },
    {
      typeId: "Int16Array",
      create: () => new Int16Array([-32768, -1, 0, 32767]),
    },
    {
      typeId: "Uint16Array",
      create: () => new Uint16Array([0, 1, 65535]),
    },
    {
      typeId: "Int32Array",
      create: () => new Int32Array([-2147483648, -1, 0, 2147483647]),
    },
    {
      typeId: "Uint32Array",
      create: () => new Uint32Array([0, 1, 4294967295]),
    },
    {
      typeId: "Float32Array",
      create: () => new Float32Array([Math.fround(1.5), Math.fround(-2.25)]),
    },
    {
      typeId: "Float64Array",
      create: () => new Float64Array([Math.PI, Math.E]),
    },
  ];

  if (typeof BigInt64Array !== "undefined") {
    factories.push({
      typeId: "BigInt64Array",
      create: () => new BigInt64Array([BigInt(-3), BigInt(0), BigInt(7)]),
    });
  }

  if (typeof BigUint64Array !== "undefined") {
    factories.push({
      typeId: "BigUint64Array",
      create: () => new BigUint64Array([BigInt(0), BigInt(9), BigInt(11)]),
    });
  }

  return factories;
};

describe("Serializer platform built-ins", () => {
  it("serializes Error with stack, cause, and custom fields", () => {
    const serializer = new Serializer();
    const original = new TypeError("boom");
    const rootCause = new Error("root");

    Object.defineProperty(original, "cause", {
      value: rootCause,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    Object.defineProperty(original, "details", {
      value: { requestId: "req-1" },
      writable: true,
      configurable: true,
      enumerable: false,
    });
    (original as unknown as Record<string, unknown>).code = "E_BANG";

    const serialized = serializer.serialize(original);
    const restored = serializer.deserialize<
      Error & { cause?: unknown; details?: unknown; code?: unknown }
    >(serialized);

    expect(restored).toBeInstanceOf(Error);
    expect(restored.name).toBe("TypeError");
    expect(restored.message).toBe("boom");
    expect(typeof restored.stack).toBe("string");
    expect(restored.code).toBe("E_BANG");
    expect(restored.details).toEqual({ requestId: "req-1" });

    const restoredCause = restored.cause;
    expect(restoredCause).toBeInstanceOf(Error);
    if (!(restoredCause instanceof Error)) {
      throw createMessageError("Expected restored cause to be an Error");
    }
    expect(restoredCause.message).toBe("root");
  });

  it("preserves self-referencing Error causes", () => {
    const serializer = new Serializer();
    const original = new Error("loop");

    Object.defineProperty(original, "cause", {
      value: original,
      writable: true,
      configurable: true,
      enumerable: false,
    });

    const serialized = serializer.serialize(original);
    const restored = serializer.deserialize<Error & { cause?: unknown }>(
      serialized,
    );

    expect(restored).toBeInstanceOf(Error);
    expect(restored.cause).toBe(restored);
  });

  it("serializes URL and URLSearchParams values", () => {
    const serializer = new Serializer();
    const originalUrl = new URL("https://example.com/path?q=1#section");
    const originalParams = new URLSearchParams();

    originalParams.append("a", "1");
    originalParams.append("a", "2");
    originalParams.append("b", "3");

    const restored = serializer.deserialize<{
      url: URL;
      params: URLSearchParams;
    }>(
      serializer.serialize({
        url: originalUrl,
        params: originalParams,
      }),
    );

    expect(restored.url).toBeInstanceOf(URL);
    expect(restored.url.href).toBe(originalUrl.href);
    expect(restored.params).toBeInstanceOf(URLSearchParams);
    expect(restored.params.getAll("a")).toEqual(["1", "2"]);
    expect(restored.params.get("b")).toBe("3");
  });

  it("serializes ArrayBuffer and DataView", () => {
    const serializer = new Serializer();

    const arrayBuffer = new Uint8Array([0, 1, 2, 255]).buffer;
    const dataViewBuffer = new ArrayBuffer(6);
    const dataView = new DataView(dataViewBuffer);
    dataView.setInt16(0, -1234);
    dataView.setUint32(2, 0xdeadbeef);

    const restored = serializer.deserialize<{
      arrayBuffer: ArrayBuffer;
      dataView: DataView;
    }>(
      serializer.serialize({
        arrayBuffer,
        dataView,
      }),
    );

    expect(restored.arrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(restored.arrayBuffer))).toEqual([
      0, 1, 2, 255,
    ]);

    expect(restored.dataView).toBeInstanceOf(DataView);
    expect(restored.dataView.getInt16(0)).toBe(-1234);
    expect(restored.dataView.getUint32(2)).toBe(0xdeadbeef);
  });

  it("serializes all supported typed arrays", () => {
    const serializer = new Serializer();
    const typedArrayFactories = createTypedArrayFactories();

    for (const { typeId, create } of typedArrayFactories) {
      const original = create();
      const serialized = serializer.serialize(original);
      const restored = serializer.deserialize<unknown>(serialized);

      const runtimeConstructor = (globalThis as Record<string, unknown>)[
        typeId
      ] as (new (buffer: ArrayBufferLike) => ArrayBufferView) | undefined;
      if (typeof runtimeConstructor !== "function") {
        throw createMessageError(`Expected ${typeId} constructor to exist`);
      }

      expect(restored).toBeInstanceOf(runtimeConstructor);
      if (!ArrayBuffer.isView(restored) || restored instanceof DataView) {
        throw createMessageError(
          `Expected restored value to be a ${typeId} view`,
        );
      }

      expect(toBytePayload(restored)).toEqual(toBytePayload(original));
    }
  });

  it("uses Buffer type in Node and round-trips bytes", () => {
    const serializer = new Serializer();
    const runtimeBufferConstructor = getRuntimeBufferConstructor();
    if (!runtimeBufferConstructor) {
      return;
    }

    const original = runtimeBufferConstructor.from([4, 8, 15, 16, 23, 42]);
    const serialized = serializer.serialize(original);
    const restored = serializer.deserialize<unknown>(serialized);

    expect(runtimeBufferConstructor.isBuffer(restored)).toBe(true);
    expect(Array.from(restored as Uint8Array)).toEqual([4, 8, 15, 16, 23, 42]);
  });

  it("fails fast on malformed binary payloads", () => {
    const serializer = new Serializer();

    expect(() =>
      serializer.deserialize(
        JSON.stringify({ __type: "ArrayBuffer", value: [0, 256, 1] }),
      ),
    ).toThrow(/Invalid ArrayBuffer payload/);

    expect(() =>
      serializer.deserialize(
        JSON.stringify({ __type: "Uint16Array", value: [0, 1, 2] }),
      ),
    ).toThrow(/Invalid Uint16Array payload/);
  });
});
