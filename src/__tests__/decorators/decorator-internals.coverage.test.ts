import { describe, expect, it } from "@jest/globals";
import { check, Match } from "../..";
import {
  Match as esMatch,
  check as esCheck,
  Serializer as EsSerializer,
} from "../../decorators/es";
import {
  Match as legacyMatch,
  check as legacyCheck,
  Serializer as LegacySerializer,
} from "../../decorators/legacy";
import {
  getDecoratorMetadataRecord,
  requireDecoratorMetadataRecord,
} from "../../decorators/metadata";
import {
  getClassSchemaDefinition,
  setClassFieldPattern,
  setEsClassFieldPattern,
  setEsClassSchemaOptions,
} from "../../tools/check/classSchema";
import {
  createEsFieldDecorator,
  createEsSchemaDecorator,
  createLegacyFieldDecorator,
  createLegacySchemaDecorator,
} from "../../tools/check/decorators";
import {
  remapObjectForSerialization,
  remapValueForSchemaDeserialize,
  setEsSerializerFieldOptions,
  type SerializerClassConstructor,
} from "../../serializer/field-metadata";
import {
  createEsSerializerFieldDecorator,
  createLegacySerializerFieldDecorator,
} from "../../serializer/decorators";

type SymbolWithMetadata = {
  metadata?: symbol;
};

const symbolWithMetadata = Symbol as unknown as SymbolWithMetadata;

function withMetadataSymbol<T>(run: () => T): T {
  if (symbolWithMetadata.metadata === undefined) {
    symbolWithMetadata.metadata = Symbol("Symbol.metadata");
  }

  return run();
}

describe("decorator internals coverage", () => {
  it("covers explicit decorator entrypoints and helpers", () => {
    expect(esMatch).toBe(Match);
    expect(esCheck("value", String)).toBe("value");
    expect(legacyMatch.Class).toBe(legacyMatch.Schema);
    expect(typeof EsSerializer.Field()).toBe("function");
    expect(typeof LegacySerializer.Field({ from: "legacy_id" })).toBe(
      "function",
    );
    expect(check("value", String)).toBe("value");
    expect(legacyCheck("value", String)).toBe("value");
  });

  it("reads and validates metadata records", () => {
    const originalMetadataSymbol = symbolWithMetadata.metadata;
    delete symbolWithMetadata.metadata;

    try {
      expect(
        getDecoratorMetadataRecord(class MissingMetadata {}),
      ).toBeUndefined();

      expect(() =>
        requireDecoratorMetadataRecord({}, "Match.Schema()", (message) => {
          throw new Error(message);
        }),
      ).toThrow("Symbol.metadata");
    } finally {
      symbolWithMetadata.metadata = originalMetadataSymbol;
    }

    withMetadataSymbol(() => {
      class NoOwnMetadata {}

      expect(getDecoratorMetadataRecord(NoOwnMetadata)).toBeUndefined();

      class BrokenMetadata {}
      Object.defineProperty(BrokenMetadata, symbolWithMetadata.metadata!, {
        value: 42,
        configurable: true,
      });
      expect(getDecoratorMetadataRecord(BrokenMetadata)).toBeUndefined();

      const metadata = { ok: true };
      class WithMetadata {}
      Object.defineProperty(WithMetadata, symbolWithMetadata.metadata!, {
        value: metadata,
        configurable: true,
      });
      expect(getDecoratorMetadataRecord(WithMetadata)).toBe(metadata);

      expect(() =>
        requireDecoratorMetadataRecord(
          { metadata: null },
          "Match.Field()",
          (message) => {
            throw new Error(message);
          },
        ),
      ).toThrow("standard decorator metadata support");

      expect(
        requireDecoratorMetadataRecord(
          { metadata },
          "Match.Field()",
          (message) => {
            throw new Error(message);
          },
        ),
      ).toBe(metadata);
    });
  });

  it("covers ES and legacy Match decorator edge cases and mixed metadata reads", () => {
    const originalMetadataSymbol = symbolWithMetadata.metadata;
    delete symbolWithMetadata.metadata;

    try {
      expect(() =>
        createEsSchemaDecorator()(class MissingMetadata {}, {
          kind: "class",
          name: "MissingMetadata",
          addInitializer: () => undefined,
          metadata: undefined,
        } as never),
      ).toThrow("Symbol.metadata");

      expect(() =>
        createEsFieldDecorator(Match.NonEmptyString)(undefined, {
          kind: "field",
          name: "id",
          static: false,
          private: false,
          access: {
            has: () => true,
            get: () => "value",
            set: () => undefined,
          },
          addInitializer: () => undefined,
          metadata: undefined,
        } as never),
      ).toThrow("Symbol.metadata");
    } finally {
      symbolWithMetadata.metadata = originalMetadataSymbol;
    }

    withMetadataSymbol(() => {
      expect(() =>
        createEsFieldDecorator(Match.NonEmptyString)(undefined, {
          kind: "field",
          name: "secret",
          static: false,
          private: true,
          access: {
            has: () => true,
            get: () => "value",
            set: () => undefined,
          },
          addInitializer: () => undefined,
          metadata: {},
        }),
      ).toThrow("private class fields");

      expect(() =>
        createEsFieldDecorator(Match.NonEmptyString)(undefined, {
          kind: "field",
          name: Symbol("id"),
          static: false,
          private: false,
          access: {
            has: () => true,
            get: () => "value",
            set: () => undefined,
          },
          addInitializer: () => undefined,
          metadata: {},
        }),
      ).toThrow("string property names");

      const metadataRecord: Record<PropertyKey, unknown> = {};
      createEsSchemaDecorator({ exact: true })(class Example {}, {
        kind: "class",
        name: "Example",
        addInitializer: () => undefined,
        metadata: metadataRecord,
      });
      createEsFieldDecorator(Match.NonEmptyString)(undefined, {
        kind: "field",
        name: "id",
        static: false,
        private: false,
        access: {
          has: () => true,
          get: () => "value",
          set: () => undefined,
        },
        addInitializer: () => undefined,
        metadata: metadataRecord,
      });

      class MixedDto {
        title!: string;
      }

      createLegacySchemaDecorator({ schemaId: "mixed.dto" })(MixedDto);
      setClassFieldPattern(MixedDto, "title", Match.NonEmptyString);

      Object.defineProperty(MixedDto, symbolWithMetadata.metadata!, {
        value: metadataRecord,
        configurable: true,
      });

      const definition = getClassSchemaDefinition(MixedDto);
      expect(definition.exact).toBe(true);
      expect(definition.schemaId).toBe("mixed.dto");
      expect(definition.pattern).toEqual({
        id: Match.NonEmptyString,
        title: Match.NonEmptyString,
      });

      expect(() =>
        createLegacyFieldDecorator(Match.Any)(
          Object.create(null) as never,
          "id",
        ),
      ).toThrow("class members");
    });
  });

  it("covers ES and legacy serializer decorator edge cases and mixed metadata remapping", () => {
    withMetadataSymbol(() => {
      expect(() =>
        createEsSerializerFieldDecorator()(undefined, {
          kind: "field",
          name: "secret",
          static: false,
          private: true,
          access: {
            has: () => true,
            get: () => "value",
            set: () => undefined,
          },
          addInitializer: () => undefined,
          metadata: {},
        }),
      ).toThrow("private class fields");

      expect(() =>
        createEsSerializerFieldDecorator()(undefined, {
          kind: "field",
          name: Symbol("id"),
          static: false,
          private: false,
          access: {
            has: () => true,
            get: () => "value",
            set: () => undefined,
          },
          addInitializer: () => undefined,
          metadata: {},
        }),
      ).toThrow("only string property names");

      expect(() =>
        createLegacySerializerFieldDecorator()(
          Object.create(null) as never,
          "id",
        ),
      ).toThrow("decorator target must be a class field");

      const metadataRecord: Record<PropertyKey, unknown> = {};
      setEsSerializerFieldOptions(metadataRecord, "id", { from: "user_id" });
      setEsSerializerFieldOptions(metadataRecord, "id", {
        from: "user_id",
        deserialize: (value) => `in:${String(value)}`,
        serialize: (value) => `out:${String(value)}`,
      });

      function LegacyAndEs(): void {
        return;
      }

      createLegacySerializerFieldDecorator({ from: "legacy" })(
        LegacyAndEs as unknown as Function,
        "legacyValue",
      );
      Object.defineProperty(LegacyAndEs, symbolWithMetadata.metadata!, {
        value: metadataRecord,
        configurable: true,
      });

      expect(
        remapValueForSchemaDeserialize(
          { user_id: "u1", legacy: "v1" },
          LegacyAndEs as unknown as SerializerClassConstructor,
        ),
      ).toEqual({ id: "in:u1", legacyValue: "v1" });

      const instance = {
        constructor: LegacyAndEs,
        id: "u1",
        legacyValue: "v1",
      };
      expect(remapObjectForSerialization(instance)).toEqual({
        user_id: "out:u1",
        legacy: "v1",
        constructor: LegacyAndEs,
      });
    });
  });

  it("covers class-schema ES metadata merging via direct helpers", () => {
    const metadataRecord: Record<PropertyKey, unknown> = {};
    setEsClassSchemaOptions(metadataRecord, { exact: true });
    setEsClassFieldPattern(metadataRecord, "name", Match.NonEmptyString);
    setEsClassFieldPattern(metadataRecord, "title", Match.NonEmptyString);

    class DirectMetadata {}

    withMetadataSymbol(() => {
      Object.defineProperty(DirectMetadata, symbolWithMetadata.metadata!, {
        value: metadataRecord,
        configurable: true,
      });
    });

    expect(getClassSchemaDefinition(DirectMetadata)).toEqual({
      exact: true,
      schemaId: "DirectMetadata",
      errorPolicy: "first",
      pattern: {
        name: Match.NonEmptyString,
        title: Match.NonEmptyString,
      },
    });
  });

  it("invalidates cached class schemas after ES metadata updates", () => {
    const metadataRecord: Record<PropertyKey, unknown> = {};

    class CachedEsMetadata {}

    withMetadataSymbol(() => {
      Object.defineProperty(CachedEsMetadata, symbolWithMetadata.metadata!, {
        value: metadataRecord,
        configurable: true,
      });
    });

    setEsClassSchemaOptions(metadataRecord, { exact: true });
    setEsClassFieldPattern(metadataRecord, "name", Match.NonEmptyString);

    const firstDefinition = getClassSchemaDefinition(CachedEsMetadata);
    const secondDefinition = getClassSchemaDefinition(CachedEsMetadata);

    expect(secondDefinition).toBe(firstDefinition);
    expect(firstDefinition.pattern).toEqual({
      name: Match.NonEmptyString,
    });

    setEsClassFieldPattern(metadataRecord, "title", Match.NonEmptyString);

    const updatedDefinition = getClassSchemaDefinition(CachedEsMetadata);

    expect(updatedDefinition).not.toBe(firstDefinition);
    expect(updatedDefinition.pattern).toEqual({
      name: Match.NonEmptyString,
      title: Match.NonEmptyString,
    });
  });
});
