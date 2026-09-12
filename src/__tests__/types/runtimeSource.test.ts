import {
  RuntimeCallSourceKind,
  runtimeSource,
} from "../../types/runtimeSource";

describe("runtimeSource", () => {
  it("freezes source factories, kinds, and records shared with user code", () => {
    expect(Object.isFrozen(runtimeSource)).toBe(true);
    expect(Object.isFrozen(RuntimeCallSourceKind)).toBe(true);
    for (const createSource of Object.values(runtimeSource)) {
      const source = createSource("stable-origin");
      expect(Object.isFrozen(source)).toBe(true);
      expect(Reflect.set(source, "id", "corrupted")).toBe(false);
      expect(Reflect.set(source, "kind", "task")).toBe(false);
      expect(source.id).toBe("stable-origin");
    }
  });

  it("creates runtime call sources", () => {
    expect(runtimeSource.runtime("runtime.api")).toEqual({
      kind: RuntimeCallSourceKind.Runtime,
      id: "runtime.api",
    });
    expect(runtimeSource.resource("resource-a")).toEqual({
      kind: RuntimeCallSourceKind.Resource,
      id: "resource-a",
    });
    expect(runtimeSource.task("task-a")).toEqual({
      kind: RuntimeCallSourceKind.Task,
      id: "task-a",
    });
    expect(runtimeSource.hook("hook-a")).toEqual({
      kind: RuntimeCallSourceKind.Hook,
      id: "hook-a",
    });
    expect(runtimeSource.taskMiddleware("middleware-a")).toEqual({
      kind: RuntimeCallSourceKind.TaskMiddleware,
      id: "middleware-a",
    });
    expect(runtimeSource.resourceMiddleware("middleware-b")).toEqual({
      kind: RuntimeCallSourceKind.ResourceMiddleware,
      id: "middleware-b",
    });
  });
});
