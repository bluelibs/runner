import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";

describe("durable: TaskRegistry", () => {
  it("rejects empty workflow keys", () => {
    const registry = new TaskRegistry(undefined, () => "");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).toThrow("empty durable workflow key");
  });

  it("rejects conflicting workflow keys from different tasks", () => {
    const registry = new TaskRegistry(undefined, (task) =>
      task.id === "task-a" ? "shared" : "shared",
    );

    registry.register({ id: "task-a" } as any);
    expect(() => registry.register({ id: "task-b" } as any)).toThrow(
      "already registered",
    );
  });

  it("allows re-registering the same task with the same workflow key", () => {
    const registry = new TaskRegistry(undefined, () => "shared");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).not.toThrow();
    expect(() => registry.register(task)).not.toThrow();
    expect(registry.find("shared")).toBe(task);
  });

  it("does not leave partial task entries behind when workflow key validation fails", () => {
    const registry = new TaskRegistry(undefined, () => "");
    const task = { id: "task-a" } as any;

    expect(() => registry.register(task)).toThrow("empty durable workflow key");
    expect(registry.find("task-a")).toBeUndefined();
  });

  it("rejects collisions when a task id matches an existing workflow key", () => {
    const registry = new TaskRegistry(undefined, (task) =>
      task.id === "task-a" ? "shared" : task.id,
    );

    registry.register({ id: "task-a" } as any);
    expect(() => registry.register({ id: "shared" } as any)).toThrow(
      "already registered",
    );
    expect(registry.find("shared")?.id).toBe("task-a");
  });

  it("rejects collisions when a new task id would overwrite an existing workflow alias", () => {
    const registry = new TaskRegistry(undefined, (task) =>
      task.id === "task-a" ? "task-b" : "workflow-b",
    );

    registry.register({ id: "task-a" } as any);
    expect(() => registry.register({ id: "task-b" } as any)).toThrow(
      "collides with an existing workflow alias",
    );
    expect(registry.find("task-b")?.id).toBe("task-a");
  });
});
