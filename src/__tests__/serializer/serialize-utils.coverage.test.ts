import { describe, expect, it } from "@jest/globals";
import {
  serializeSymbolValue,
  serializeTypeRecord,
} from "../../serializer/serialize-utils";
import { TypeRegistry } from "../../serializer/type-registry";

describe("serialize-utils coverage", () => {
  it("serializes type records and excludes the active type id during recursion", () => {
    const excluded: string[] = [];
    let seenExcluded: string[] = [];
    const result = serializeTypeRecord(
      {
        id: "Wrapper",
        is: (_v: unknown): _v is { inner: number } => true,
        serialize: (v) => {
          seenExcluded = [...excluded];
          return v;
        },
        deserialize: (v) => v,
      },
      { inner: 1 },
      excluded,
      (nested) => nested,
    );

    expect(seenExcluded).toEqual(["Wrapper"]);
    expect(excluded).toEqual([]);
    expect(result).toEqual({
      __type: "Wrapper",
      value: { inner: 1 },
    });
  });

  it("serializes registered symbols via serializeSymbolValue", () => {
    const registry = new TypeRegistry({
      allowedTypes: null,
      regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
      symbolPolicy: "allow-all",
    });

    const result = serializeSymbolValue(
      Symbol.for("serialize-utils.cov"),
      [],
      registry,
      (nested) => nested,
    );

    expect(result).toEqual({
      __type: "Symbol",
      value: { kind: "For", key: "serialize-utils.cov" },
    });
  });
});
