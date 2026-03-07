import {
  defineFrameworkAsyncContext,
  defineFrameworkError,
} from "../../definers/frameworkDefinition";
import {
  isFrameworkDefinitionMarked,
  markFrameworkDefinition,
} from "../../definers/markFrameworkDefinition";
import { symbolFilePath, symbolFrameworkDefinition } from "../../types/symbols";

describe("framework definition helpers", () => {
  it("marks plain definitions and recognizes framework-owned markers across supported inputs", () => {
    const definition = { id: "runner.tags.internal" };
    const markedDefinition = markFrameworkDefinition(definition);
    const markedFunction = Object.assign(() => undefined, {
      [symbolFrameworkDefinition]: true,
    });

    expect(markedDefinition).toMatchObject({
      id: "runner.tags.internal",
      [symbolFrameworkDefinition]: true,
    });
    expect(isFrameworkDefinitionMarked(markedDefinition)).toBe(true);
    expect(isFrameworkDefinitionMarked(markedFunction)).toBe(true);
    expect(isFrameworkDefinitionMarked({ id: "runner.tags.internal" })).toBe(
      false,
    );
    expect(isFrameworkDefinitionMarked(null)).toBe(false);
    expect(isFrameworkDefinitionMarked(undefined)).toBe(false);
    expect(isFrameworkDefinitionMarked("runner.tags.internal")).toBe(false);
  });

  it("allows reserved framework ids for async contexts and forwards file paths to errors", () => {
    const asyncContext = defineFrameworkAsyncContext({
      id: "runner.contexts.internal",
    });
    const error = defineFrameworkError(
      {
        id: "runner.errors.internal",
      },
      "/virtual/framework-definition.test.ts",
    );

    expect(asyncContext.id).toBe("runner.contexts.internal");
    expect(error.id).toBe("runner.errors.internal");
    expect(error[symbolFilePath]).toBe("/virtual/framework-definition.test.ts");
  });
});
