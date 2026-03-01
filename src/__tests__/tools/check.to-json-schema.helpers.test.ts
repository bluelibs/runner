import { CheckJsonSchemaPatternError } from "../../tools/check";
import {
  appendIndex,
  appendKey,
  throwUnsupported,
  withCycleGuard,
} from "../../tools/check/toJsonSchema.helpers";

function expectHelperError(run: () => unknown): CheckJsonSchemaPatternError {
  try {
    run();
    throw new Error("Expected CheckJsonSchemaPatternError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckJsonSchemaPatternError);
    return error as CheckJsonSchemaPatternError;
  }
}

describe("tools/check toJsonSchema helpers", () => {
  it("formats path segments consistently", () => {
    expect(appendKey("$", "profile")).toBe("$.profile");
    expect(appendKey("$", "full-name")).toBe('$["full-name"]');
    expect(appendIndex("$.users", 2)).toBe("$.users[2]");
  });

  it("classifies unsupported pattern kinds", () => {
    const tokenError = expectHelperError(() =>
      throwUnsupported("$", "unsupported", { kind: "Match.OptionalPattern" }),
    );
    expect(tokenError.patternKind).toBe("Match.Optional");

    const tokenWithoutSuffix = expectHelperError(() =>
      throwUnsupported("$", "unsupported", { kind: "Match.Any" }),
    );
    expect(tokenWithoutSuffix.patternKind).toBe("Match.Any");

    const constructorError = expectHelperError(() =>
      throwUnsupported("$", "unsupported", String),
    );
    expect(constructorError.patternKind).toBe("String");

    const nullError = expectHelperError(() =>
      throwUnsupported("$", "unsupported", null),
    );
    expect(nullError.patternKind).toBe("null literal");

    const primitiveError = expectHelperError(() =>
      throwUnsupported("$", "unsupported", "value"),
    );
    expect(primitiveError.patternKind).toBe("string literal");
  });

  it("throws on cycle detection and returns execution result otherwise", () => {
    const context = { activePatterns: new WeakSet<object>() };
    const pattern = {};
    const value = withCycleGuard(pattern, context, "$", () => "ok");
    expect(value).toBe("ok");

    context.activePatterns.add(pattern);
    const cycleError = expectHelperError(() =>
      withCycleGuard(pattern, context, "$.self", () => "never"),
    );
    expect(cycleError.path).toBe("$.self");
  });
});
