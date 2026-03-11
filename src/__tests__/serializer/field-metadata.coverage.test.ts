import { describe, expect, it } from "@jest/globals";
import {
  remapObjectForSerialization,
  remapValueForSchemaDeserialize,
  setSerializerFieldOptions,
  type SerializerClassConstructor,
} from "../../serializer/field-metadata";

describe("serializer field-metadata coverage", () => {
  it("handles broken class-chain constructor metadata safely", () => {
    function Broken(): void {
      return;
    }

    Object.defineProperty(Broken.prototype, "constructor", {
      value: 42,
      configurable: true,
    });

    const value = remapValueForSchemaDeserialize(
      { id: "u1" },
      Broken as unknown as SerializerClassConstructor,
    );

    expect(value).toEqual({ id: "u1" });
  });

  it("returns value unchanged for non-object and non-plain object deserialize inputs", () => {
    class DeserializeOnly {
      public id!: string;
    }

    setSerializerFieldOptions(DeserializeOnly, "id", {
      deserialize(value: unknown): unknown {
        return value;
      },
    });

    expect(
      remapValueForSchemaDeserialize(
        "raw",
        DeserializeOnly as unknown as SerializerClassConstructor,
      ),
    ).toBe("raw");

    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(
      remapValueForSchemaDeserialize(
        date,
        DeserializeOnly as unknown as SerializerClassConstructor,
      ),
    ).toBe(date);
  });

  it("supports null-prototype plain objects during deserialize remap", () => {
    class Aliased {
      public id!: string;
    }

    setSerializerFieldOptions(Aliased, "id", { from: "abc" });

    const source = Object.create(null) as Record<string, unknown>;
    source.abc = "u1";

    expect(
      remapValueForSchemaDeserialize(
        source,
        Aliased as unknown as SerializerClassConstructor,
      ),
    ).toEqual({ id: "u1" });
  });

  it("skips inherited enumerable keys during deserialize remap", () => {
    class WithTransform {
      public id!: string;
    }

    setSerializerFieldOptions(WithTransform, "id", {
      deserialize(value: unknown): unknown {
        return value;
      },
    });

    const source = Object.create({ id: "inherited" }) as Record<
      string,
      unknown
    >;

    expect(
      remapValueForSchemaDeserialize(
        source,
        WithTransform as unknown as SerializerClassConstructor,
      ),
    ).toEqual({});
  });

  it("uses <anonymous> fallback in deserialize conflict messages", () => {
    function Anonymous(): void {
      return;
    }

    Object.defineProperty(Anonymous, "name", { value: "" });

    setSerializerFieldOptions(
      Anonymous as unknown as SerializerClassConstructor,
      "id",
      { from: "abc" },
    );

    expect(() =>
      remapValueForSchemaDeserialize(
        { abc: "u1", id: "u2" },
        Anonymous as unknown as SerializerClassConstructor,
      ),
    ).toThrow("<anonymous>");
  });

  it("skips inherited enumerable keys during serialization remap", () => {
    function OutCtor(): void {
      return;
    }

    setSerializerFieldOptions(
      OutCtor as unknown as SerializerClassConstructor,
      "id",
      {
        serialize(value: unknown): unknown {
          return value;
        },
      },
    );

    const source = Object.create({ inherited: "skip" }) as Record<
      string,
      unknown
    >;
    source.id = "u1";
    Object.defineProperty(source, "constructor", {
      value: OutCtor,
      enumerable: false,
    });

    expect(remapObjectForSerialization(source)).toEqual({ id: "u1" });
  });

  it("uses <anonymous> fallback in serialize conflict messages", () => {
    function AnonymousOut(): void {
      return;
    }

    Object.defineProperty(AnonymousOut, "name", { value: "" });

    setSerializerFieldOptions(
      AnonymousOut as unknown as SerializerClassConstructor,
      "id",
      { from: "abc" },
    );

    const source = {
      id: "u1",
      abc: "u2",
      constructor: AnonymousOut,
    };

    expect(() => remapObjectForSerialization(source)).toThrow("<anonymous>");
  });

  it("returns value unchanged when constructor is not a function", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.id = "u1";

    expect(remapObjectForSerialization(value)).toBe(value);
  });
});
