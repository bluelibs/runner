import {
  RuntimeCallSourceKind,
  runtimeSource,
} from "../../types/runtimeSource";

describe("runtimeSource", () => {
  it("keeps path undefined unless a canonical path is provided", () => {
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
    expect(runtimeSource.middleware("middleware-a")).toEqual({
      kind: RuntimeCallSourceKind.Middleware,
      id: "middleware-a",
    });
  });

  it("preserves explicit canonical paths when callers provide them", () => {
    expect(runtimeSource.resource("resource-a", "app.resource-a")).toEqual({
      kind: RuntimeCallSourceKind.Resource,
      id: "resource-a",
      path: "app.resource-a",
    });
  });
});
