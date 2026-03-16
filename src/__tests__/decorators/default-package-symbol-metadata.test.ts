import { Match as legacyMatch } from "../../decorators/legacy";

type SymbolWithMetadata = {
  metadata?: symbol;
};

const symbolWithMetadata = Symbol as unknown as SymbolWithMetadata;

function clearSymbolMetadata(): void {
  const deleted = delete symbolWithMetadata.metadata;

  if (!deleted && symbolWithMetadata.metadata !== undefined) {
    throw new Error("Test requires Symbol.metadata to be configurable.");
  }
}

function restoreSymbolMetadata(
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(Symbol, "metadata", descriptor);
    return;
  }

  clearSymbolMetadata();
}

describe("default package Symbol.metadata bootstrap", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("bootstraps Symbol.metadata from the default package when it is missing", () => {
    const originalMetadataDescriptor = Object.getOwnPropertyDescriptor(
      Symbol,
      "metadata",
    );

    clearSymbolMetadata();

    try {
      jest.isolateModules(() => {
        const { Match } = require("../..") as typeof import("../..");

        expect(symbolWithMetadata.metadata).toBeDefined();

        @Match.Schema()
        class UserDto {
          @Match.Field(Match.NonEmptyString)
          id!: string;
        }

        const parsed = Match.fromSchema(UserDto).parse({ id: "user_1" });

        expect(parsed).toBeInstanceOf(UserDto);
        expect(parsed).toEqual({ id: "user_1" });
      });
    } finally {
      restoreSymbolMetadata(originalMetadataDescriptor);
    }
  });

  it("preserves an existing Symbol.metadata implementation", () => {
    const originalMetadataDescriptor = Object.getOwnPropertyDescriptor(
      Symbol,
      "metadata",
    );
    const existingMetadataSymbol = Symbol("existing.metadata");

    Object.defineProperty(Symbol, "metadata", {
      value: existingMetadataSymbol,
      configurable: true,
      writable: true,
    });

    try {
      jest.isolateModules(() => {
        require("../..");

        expect(symbolWithMetadata.metadata).toBe(existingMetadataSymbol);
      });
    } finally {
      restoreSymbolMetadata(originalMetadataDescriptor);
    }
  });

  it("leaves the legacy decorator path working without Symbol.metadata", () => {
    const originalMetadataDescriptor = Object.getOwnPropertyDescriptor(
      Symbol,
      "metadata",
    );

    clearSymbolMetadata();

    try {
      class LegacyUserDto {
        id!: string;
      }

      legacyMatch.Schema()(LegacyUserDto);
      legacyMatch.Field(legacyMatch.NonEmptyString)(
        LegacyUserDto.prototype,
        "id",
      );

      const parsed = legacyMatch.fromSchema(LegacyUserDto).parse({
        id: "legacy_1",
      });

      expect(symbolWithMetadata.metadata).toBeUndefined();
      expect(parsed).toBeInstanceOf(LegacyUserDto);
      expect(parsed).toEqual({ id: "legacy_1" });
    } finally {
      restoreSymbolMetadata(originalMetadataDescriptor);
    }
  });
});
