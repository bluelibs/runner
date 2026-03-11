import { toPublicDefinition } from "../../../models/utils/toPublicDefinition";
import { symbolRuntimeId } from "../../../types/symbols";

describe("toPublicDefinition()", () => {
  it("delegates to store.toPublicDefinition when available", () => {
    const definition = { id: "task-a" };
    const delegated = { id: "public-task-a", path: "tasks.task-a" };
    const store = {
      toPublicId: () => "unused",
      toPublicDefinition: () => delegated,
    };

    expect(toPublicDefinition(store as any, definition)).toBe(delegated);
  });

  it("stamps path and runtime id when only scalar helpers are available", () => {
    const definition = { id: "task-b" };
    const publicDefinition = toPublicDefinition(
      {
        toPublicId: () => "task-b",
        toPublicPath: () => "tasks.task-b",
      } as any,
      definition,
    ) as Record<string | symbol, unknown>;

    expect(publicDefinition.id).toBe("task-b");
    expect(publicDefinition.path).toBe("tasks.task-b");
    expect(publicDefinition[symbolRuntimeId]).toBe("tasks.task-b");
  });

  it("falls back to public ids when toPublicPath is unavailable", () => {
    const publicDefinition = toPublicDefinition(
      {
        toPublicId: () => "task-c",
      } as any,
      { id: "task-c" },
    ) as Record<string | symbol, unknown>;

    expect(publicDefinition.path).toBe("task-c");
    expect(publicDefinition[symbolRuntimeId]).toBe("task-c");
  });
});
