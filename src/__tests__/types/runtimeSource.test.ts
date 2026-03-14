import {
  RuntimeCallSourceKind,
  runtimeSource,
} from "../../types/runtimeSource";

describe("runtimeSource", () => {
  it("creates canonical-only runtime sources", () => {
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
