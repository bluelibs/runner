import { TaskRegistry } from "../../durable/core/managers/TaskRegistry";

describe("durable: TaskRegistry", () => {
  it("rejects empty persistence ids", () => {
    const registry = new TaskRegistry(undefined, () => "");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).toThrow(
      "empty durable persistence id",
    );
  });

  it("rejects conflicting persistence ids from different tasks", () => {
    const registry = new TaskRegistry(undefined, (task) =>
      task.id === "task-a" ? "shared" : "shared",
    );

    registry.register({ id: "task-a" } as any);
    expect(() => registry.register({ id: "task-b" } as any)).toThrow(
      "already registered",
    );
  });

  it("allows re-registering the same task with the same persistence id", () => {
    const registry = new TaskRegistry(undefined, () => "shared");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).not.toThrow();
    expect(() => registry.register(task)).not.toThrow();
    expect(registry.find("shared")).toBe(task);
  });

  it("does not leave partial task entries behind when persistence id validation fails", () => {
    const registry = new TaskRegistry(undefined, () => "");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).toThrow(
      "empty durable persistence id",
    );
    expect(registry.find("task-a")).toBeUndefined();
  });

  it("rejects collisions when a task id matches an existing persistence id", () => {
    const registry = new TaskRegistry(undefined, (task) =>
      task.id === "task-a" ? "shared" : task.id,
    );

    registry.register({ id: "task-a" } as any);
    expect(() => registry.register({ id: "shared" } as any)).toThrow(
      "already registered",
    );
    expect(registry.find("shared")?.id).toBe("task-a");
  });
});
