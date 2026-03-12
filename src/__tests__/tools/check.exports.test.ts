import * as checkExports from "../../tools/check";

describe("tools/check exports", () => {
  it("exports helper-based check error utilities instead of legacy classes", () => {
    const checkExportsRecord = checkExports as Record<string, unknown>;

    expect(typeof checkExports.createMatchError).toBe("function");
    expect(typeof checkExports.createMatchPatternError).toBe("function");
    expect(typeof checkExports.createCheckOptionsError).toBe("function");
    expect(typeof checkExports.createCheckJsonSchemaPatternError).toBe(
      "function",
    );
    expect(typeof checkExports.isMatchError).toBe("function");
    expect(checkExportsRecord.MatchError).toBeUndefined();
    expect(checkExportsRecord.MatchPatternError).toBeUndefined();
    expect(checkExportsRecord.CheckOptionsError).toBeUndefined();
  });

  it("keeps the helper utility exports callable from the barrel", () => {
    expect(checkExports.rootFailure()).toEqual({
      path: "$",
      expected: "valid pattern",
      actualType: "unknown",
      message: "Match failed at $.",
    });

    expect(checkExports.getMatchErrorMessage([])).toBe(
      "Match failed with 0 errors:\n",
    );
    expect(
      checkExports.getMatchErrorMessage([
        {
          path: "$.id",
          expected: "string",
          actualType: "number",
          message: "Expected string, got number at $.id.",
        },
      ]),
    ).toBe("Expected string, got number at $.id.");

    const schemaError = checkExports.createCheckJsonSchemaPatternError(
      "$.field",
      "unsupported",
      "Match.Where",
    );

    expect(schemaError.path).toBe("$.field");
    expect(schemaError.reason).toBe("unsupported");
    expect(schemaError.patternKind).toBe("Match.Where");
  });
});
