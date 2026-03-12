import {
  checkJsonSchemaUnsupportedPatternError,
  matchError,
} from "../../errors/foundation/match.errors";
import {
  createMatchError,
  createCheckJsonSchemaPatternError,
  getMatchErrorMessage,
  rootFailure,
} from "../../tools/check/errors";

describe("tools/check error helpers coverage", () => {
  it("exposes barrel helpers and preserves convenience fields", () => {
    const failure = rootFailure();
    expect(failure.path).toBe("$");

    expect(
      getMatchErrorMessage([
        {
          path: "$.name",
          expected: "string",
          actualType: "number",
          message: "Expected string, got number at $.name.",
        },
      ]),
    ).toBe("Expected string, got number at $.name.");

    const error = createCheckJsonSchemaPatternError(
      "$.profile.custom",
      "Match.Where is not supported in JSON Schema.",
      "Match.Where",
    );

    expect(error.path).toBe("$.profile.custom");
    expect(error.reason).toContain("Match.Where");
    expect(error.patternKind).toBe("Match.Where");
  });

  it("formats empty and aggregate match helper failures", () => {
    const emptyError = matchError.new({
      path: "$",
      failures: [],
    });
    expect(emptyError.message).toBe("Match failed at $.");

    const aggregateError = matchError.new({
      path: "$.profile",
      failures: [
        {
          path: "$.profile.name",
          expected: "string",
          actualType: "number",
          message: "Expected string, got number at $.profile.name.",
        },
        {
          path: "$.profile.age",
          expected: "number",
          actualType: "string",
          message: "Expected number, got string at $.profile.age.",
        },
      ],
    });

    expect(aggregateError.message).toBe(
      "Match failed with 2 errors:\n- Expected string, got number at $.profile.name.\n- Expected number, got string at $.profile.age.",
    );
  });

  it("keeps remediation on json-schema helper errors", () => {
    const error = checkJsonSchemaUnsupportedPatternError.new({
      path: "$",
      reason: "unsupported",
      patternKind: "Function",
    });

    expect(error.httpCode).toBe(400);
    expect(error.remediation).toContain("JSON Schema");
  });

  it("projects convenience fields on compatibility error instances", () => {
    const error = createMatchError([
      {
        path: "$.retries",
        expected: "number",
        actualType: "string",
        message: "Expected number, got string at $.retries.",
      },
    ]);

    expect(error.path).toBe("$.retries");
    expect(error.failures).toHaveLength(1);
  });
});
