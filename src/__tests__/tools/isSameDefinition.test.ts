import { defineTag, defineTask } from "../../define";
import {
  hasDefinitionIdentity,
  isSameDefinition,
} from "../../tools/isSameDefinition";
import {
  symbolDefinitionIdentity,
  symbolTagConfiguredFrom,
} from "../../types/symbols";

describe("isSameDefinition()", () => {
  it("matches runner definitions by stable identity across runtime clones", () => {
    const task = defineTask({
      id: "same-definition-task",
      run: async () => "ok",
    });

    const runtimeProjection = {
      ...task,
      id: "public-task-id",
    };

    expect(isSameDefinition(task, task)).toBe(true);
    expect(isSameDefinition(runtimeProjection, task)).toBe(true);
  });

  it("distinguishes sibling definitions that only share a local id", () => {
    const leftTask = defineTask({
      id: "shared-task",
      run: async () => "left",
    });
    const rightTask = defineTask({
      id: "shared-task",
      run: async () => "right",
    });

    expect(isSameDefinition(leftTask, rightTask)).toBe(false);
  });

  it("falls back to raw ids only when neither side has runner identity", () => {
    expect(isSameDefinition({ id: "plain" }, { id: "plain" })).toBe(true);
    expect(isSameDefinition({ id: "plain" }, { id: "other" })).toBe(false);
    expect(isSameDefinition({ id: 1 }, { id: 1 })).toBe(false);
    expect(isSameDefinition("plain", { id: "plain" })).toBe(false);
  });

  it("does not treat identity-aware definitions as equal to plain id lookalikes", () => {
    const task = defineTask({
      id: "identity-aware-task",
      run: async () => "ok",
    });

    expect(isSameDefinition(task, { id: task.id })).toBe(false);
  });

  it("resolves configured-from fallback identities for tag-like clones", () => {
    const tag = defineTag({
      id: "same-definition-tag",
    });
    const configuredClone = {
      [symbolTagConfiguredFrom]: tag,
    };
    const foreignConfiguredClone = {
      [symbolTagConfiguredFrom]: {
        [symbolDefinitionIdentity]: {},
      },
    };
    const invalidConfiguredClone = {
      [symbolTagConfiguredFrom]: "not-an-object",
    };
    const nullIdentityConfiguredClone = {
      [symbolTagConfiguredFrom]: {
        [symbolDefinitionIdentity]: null,
      },
    };

    expect(isSameDefinition(configuredClone, tag)).toBe(true);
    expect(isSameDefinition(foreignConfiguredClone, tag)).toBe(false);
    expect(isSameDefinition(invalidConfiguredClone, tag)).toBe(false);
    expect(isSameDefinition(nullIdentityConfiguredClone, tag)).toBe(false);
  });

  it("reports whether a value retains Runner definition identity", () => {
    const task = defineTask({
      id: "same-definition-identity-check",
      run: async () => "ok",
    });

    expect(hasDefinitionIdentity(task)).toBe(true);
    expect(hasDefinitionIdentity({ id: task.id })).toBe(false);
  });
});
