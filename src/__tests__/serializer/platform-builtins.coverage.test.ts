import { describe, expect, it } from "@jest/globals";
import {
  ErrorType,
  URLSearchParamsType,
  URLType,
} from "../../serializer/error-url-builtins";
import {
  BufferType,
  binaryBuiltInTypes,
} from "../../serializer/binary-builtins";
import { RegExpType } from "../../serializer/builtins";
import type { TypeDefinition } from "../../serializer/types";
import { createMessageError } from "../../errors";

const hasOwn = Object.prototype.hasOwnProperty;

type RuntimeBufferConstructor = {
  from(data: readonly number[]): Uint8Array;
  isBuffer(value: unknown): boolean;
};

const withPatchedGlobal = <T>(key: string, value: unknown, run: () => T): T => {
  const globalRecord = globalThis as Record<string, unknown>;
  const hadKey = hasOwn.call(globalRecord, key);
  const previousValue = globalRecord[key];
  globalRecord[key] = value;
  try {
    return run();
  } finally {
    if (hadKey) {
      globalRecord[key] = previousValue;
    } else {
      delete globalRecord[key];
    }
  }
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

const getTypeById = (typeId: string): TypeDefinition<unknown, unknown> => {
  const match = binaryBuiltInTypes.find((typeDef) => typeDef.id === typeId);
  if (!match) {
    throw createMessageError(`Missing binary built-in type "${typeId}"`);
  }
  return match;
};

describe("Serializer platform built-ins coverage", () => {
  it("validates Error payload shape and custom field filtering", () => {
    expect(() => ErrorType.deserialize("bad" as never)).toThrow(
      "Invalid Error payload",
    );
    expect(() =>
      ErrorType.deserialize({
        name: 42,
        message: "x",
        customFields: {},
      } as never),
    ).toThrow("Invalid Error payload");
    expect(() =>
      ErrorType.deserialize({
        name: "x",
        message: "x",
        stack: 12,
        customFields: {},
      } as never),
    ).toThrow("Invalid Error payload");
    expect(() =>
      ErrorType.deserialize({
        name: "x",
        message: "x",
        customFields: 12,
      } as never),
    ).toThrow("Invalid Error payload");

    const restoredWithoutCustomFields = ErrorType.deserialize({
      name: "base",
      message: "m",
    } as never);
    expect(restoredWithoutCustomFields.message).toBe("m");

    const unsafeFields: Record<string, unknown> = Object.create(null);
    unsafeFields.__proto__ = "blocked";
    unsafeFields.name = "override";
    unsafeFields["toString"] = "blocked-to-string";
    unsafeFields["valueOf"] = "blocked-value-of";
    unsafeFields["hasOwnProperty"] = "blocked-has-own";
    unsafeFields.ok = true;

    const restored = ErrorType.deserialize({
      name: "base",
      message: "m",
      customFields: unsafeFields,
    });
    expect(restored.name).toBe("base");
    expect((restored as unknown as Record<string, unknown>).ok).toBe(true);
    expect((restored as unknown as Record<string, unknown>).toString).toBe(
      Error.prototype.toString,
    );
    expect((restored as unknown as Record<string, unknown>).valueOf).toBe(
      Error.prototype.valueOf,
    );
    expect(
      (restored as unknown as Record<string, unknown>).hasOwnProperty,
    ).toBe(Object.prototype.hasOwnProperty);
  });

  it("skips reserved and descriptor-only Error custom fields on serialize", () => {
    const original = new Error("x");
    Object.defineProperty(original, "constructor", {
      value: "blocked",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(original, "computed", {
      get: () => "value",
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(original, "toString", {
      value: "blocked",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    (original as unknown as Record<string, unknown>).safe = "ok";

    const restored = ErrorType.deserialize(ErrorType.serialize(original));
    expect((restored as unknown as Record<string, unknown>).safe).toBe("ok");
    expect(
      (restored as unknown as Record<string, unknown>).computed,
    ).toBeUndefined();
    expect((restored as unknown as Record<string, unknown>).toString).toBe(
      Error.prototype.toString,
    );
    expect(restored.name).toBe("Error");
  });

  it("omits non-string stack values when serializing Error", () => {
    const original = new Error("x");
    Object.defineProperty(original, "stack", {
      value: 123,
      writable: true,
      configurable: true,
    });

    const payload = ErrorType.serialize(original);
    expect("stack" in payload).toBe(false);
  });

  it("handles URL and URLSearchParams constructor guards and payload checks", () => {
    expect(() => URLType.deserialize(12 as never)).toThrow(
      "Invalid URL payload",
    );
    expect(() => URLSearchParamsType.deserialize(12 as never)).toThrow(
      "Invalid URLSearchParams payload",
    );

    const originalUrl = new URL("https://example.com");
    const originalParams = new URLSearchParams("a=1");

    withPatchedGlobal("URL", undefined, () => {
      expect(URLType.is(originalUrl)).toBe(false);
      expect(() => URLType.deserialize("https://example.com")).toThrow(
        "URL is not available in this runtime",
      );
    });

    withPatchedGlobal("URLSearchParams", undefined, () => {
      expect(URLSearchParamsType.is(originalParams)).toBe(false);
      expect(() => URLSearchParamsType.deserialize("a=1")).toThrow(
        "URLSearchParams is not available in this runtime",
      );
    });
  });

  it("handles binary constructor guards and Buffer fallbacks", () => {
    expect(() => BufferType.deserialize({} as never)).toThrow(
      "Invalid Buffer payload",
    );
    expect(() => BufferType.deserialize([1, 2, 3.5] as never)).toThrow(
      "Invalid Buffer payload",
    );

    withPatchedGlobal("Buffer", undefined, () => {
      const restored = BufferType.deserialize([1, 2, 3]);
      expect(restored).toBeInstanceOf(Uint8Array);
      expect(Array.from(restored)).toEqual([1, 2, 3]);

      const uint8Type = getTypeById("Uint8Array");
      expect(uint8Type.is(new Uint8Array([1, 2, 3]))).toBe(true);
    });

    withPatchedGlobal(
      "Buffer",
      function FakeBuffer() {},
      () => {
        const restored = BufferType.deserialize([4, 5, 6]);
        expect(restored).toBeInstanceOf(Uint8Array);
        expect(Array.from(restored)).toEqual([4, 5, 6]);
      },
    );

    const int8Type = getTypeById("Int8Array");
    const originalInt8 = new Int8Array([1, 2, 3]);
    withPatchedGlobal("Int8Array", undefined, () => {
      expect(int8Type.is(originalInt8)).toBe(false);
      expect(() => int8Type.deserialize([1, 2, 3])).toThrow(
        "Int8Array is not available in this runtime",
      );
    });

    const uint8Type = getTypeById("Uint8Array");
    const runtimeBufferConstructor = getRuntimeBufferConstructor();
    if (runtimeBufferConstructor) {
      const bufferValue = runtimeBufferConstructor.from([9, 8, 7]);
      expect(uint8Type.is(bufferValue)).toBe(false);
    }
  });

  it("rejects malformed ArrayBuffer and typed array payloads", () => {
    const arrayBufferType = getTypeById("ArrayBuffer");
    const uint16Type = getTypeById("Uint16Array");

    expect(() => arrayBufferType.deserialize({})).toThrow(
      "Invalid ArrayBuffer payload",
    );
    expect(() => uint16Type.deserialize([1, 2, 3])).toThrow(
      "Invalid Uint16Array payload",
    );
  });

  it("rejects malformed RegExp payloads at built-in deserialize level", () => {
    expect(() =>
      RegExpType.deserialize({
        pattern: "\\",
        flags: "",
      }),
    ).toThrow("Invalid RegExp payload");
  });
});
