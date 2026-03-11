import {
  getRuntimeId,
  getRuntimePath,
  hasRuntimeId,
} from "../../tools/runtimeMetadata";
import { symbolRuntimeId } from "../../types/symbols";

describe("runtimeMetadata helpers", () => {
  it("reads stamped runtime ids and reports presence", () => {
    const value = {
      [symbolRuntimeId]: "tasks.runtime-metadata",
    };

    expect(getRuntimeId(value)).toBe("tasks.runtime-metadata");
    expect(hasRuntimeId(value)).toBe(true);
  });

  it("falls back gracefully for literals, missing ids, and explicit paths", () => {
    expect(getRuntimeId("runtime.literal")).toBe("runtime.literal");
    expect(getRuntimeId("")).toBeUndefined();
    expect(getRuntimeId(42)).toBeUndefined();
    expect(hasRuntimeId(null)).toBe(false);
    expect(getRuntimePath("runtime.literal")).toBe("runtime.literal");
    expect(
      getRuntimePath({
        path: "tasks.runtime-path",
        [symbolRuntimeId]: "",
      }),
    ).toBe("tasks.runtime-path");
    expect(
      getRuntimePath({
        [symbolRuntimeId]: "tasks.runtime-fallback",
      }),
    ).toBe("tasks.runtime-fallback");
    expect(getRuntimePath({ path: "" })).toBeUndefined();
  });
});
