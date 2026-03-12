import * as checkExports from "../../tools/check";
import {
  createCheckJsonSchemaPatternError,
  getMatchErrorMessage,
  rootFailure,
} from "../../tools/check/errors";

describe("tools/check exports", () => {
  it("exposes the stable public check surface without legacy classes", () => {
    const checkExportsRecord = checkExports as Record<string, unknown>;

    expect(typeof checkExports.isMatchError).toBe("function");
    expect(checkExportsRecord.createMatchError).toBeUndefined();
    expect(checkExportsRecord.createMatchPatternError).toBeUndefined();
    expect(checkExportsRecord.createCheckOptionsError).toBeUndefined();
    expect(
      checkExportsRecord.createCheckJsonSchemaPatternError,
    ).toBeUndefined();
    expect(checkExportsRecord.getMatchErrorMessage).toBeUndefined();
    expect(checkExportsRecord.rootFailure).toBeUndefined();
    expect(checkExportsRecord.MatchError).toBeUndefined();
    expect(checkExportsRecord.MatchPatternError).toBeUndefined();
    expect(checkExportsRecord.CheckOptionsError).toBeUndefined();
  });

  it("keeps internal helper utilities callable from the local module", () => {
    expect(rootFailure()).toEqual({
      path: "$",
      expected: "valid pattern",
      actualType: "unknown",
      message: "Match failed at $.",
    });

    expect(getMatchErrorMessage([])).toBe("Match failed at $.");
    expect(
      getMatchErrorMessage([
        {
          path: "$.id",
          expected: "string",
          actualType: "number",
          message: "Expected string, got number at $.id.",
        },
      ]),
    ).toBe("Expected string, got number at $.id.");

    const schemaError = createCheckJsonSchemaPatternError(
      "$.field",
      "unsupported",
      "Match.Where",
    );

    expect(schemaError.path).toBe("$.field");
    expect(schemaError.reason).toBe("unsupported");
    expect(schemaError.patternKind).toBe("Match.Where");
  });
});
