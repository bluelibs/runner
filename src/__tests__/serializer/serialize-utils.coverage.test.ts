import { serializeRecordEntries } from "../../serializer/serialize-utils";

describe("serialize-utils coverage", () => {
  it("uses the default mapKey mapper when none is provided", () => {
    const result = serializeRecordEntries(
      { alpha: 1 },
      new Set<string>(),
      (value) => value as number,
    );

    expect(result).toEqual({ alpha: 1 });
  });
});
