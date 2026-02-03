import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

/**
 * Dry-run behaviour tests
 */
describe("run (dry-run)", () => {
  it("a) should work with dry run (no init, returns RunResult with store)", async () => {
    const init = jest.fn(async () => "value");

    const r = defineResource({
      id: "dry.app",
      register: [],
      init,
    });

    const result = await run(r, { dryRun: true });

    // In dry run, init must NOT be called
    expect(init).not.toHaveBeenCalled();

    // RunResult and store exist
    expect(result).toBeTruthy();
    expect(result.store).toBeTruthy();

    // value is undefined because root hasn't been initialised
    expect(result.value).toBeUndefined();

    // dispose should be callable even in dry run
    await result.dispose();
  });

  it("b) should not catch exceptions from resources in dry run (synchronous registration-time throw)", async () => {
    const inner = defineResource({
      id: "inner.bad",
      init: async () => "ok",
    });

    const bad = defineResource({
      id: "dry.bad",
      // Throw during registration so error surfaces during run() (dry run still executes registration)
      register: () => {
        throw new Error("Registration failed");

        return [inner];
      },
    });

    await expect(run(bad, { dryRun: true })).rejects.toThrow(
      "Registration failed",
    );
  });

  it("c) dry run exposes store; resources and tasks are present in store maps", async () => {
    const task = defineTask({
      id: "dry.task",
      run: async () => "task-result",
    });

    const dep = defineResource({
      id: "dry.dep",
      init: async () => "dep-value",
    });

    const app = defineResource({
      id: "dry.app2",
      register: [task, dep],
      dependencies: { dep },
      async init(_, { dep }) {
        return dep;
      },
    });

    const result = await run(app, { dryRun: true });

    // Store should contain our items
    expect(result.store.resources.has("dry.dep")).toBe(true);
    expect(result.store.resources.has("dry.app2")).toBe(true);
    expect(result.store.tasks.has("dry.task")).toBe(true);

    // Global built-ins should also exist
    expect(result.store.resources.size).toBeGreaterThan(0);

    await result.dispose();
  });

  it("d) circular dependencies still throw during dry run validation", async () => {
    // Circular resources
    const r1: any = defineResource({
      id: "circular.r1",
      dependencies: (): any => ({ r2 }),
      init: async () => "r1",
    });
    const r2 = defineResource({
      id: "circular.r2",
      dependencies: { r1 },
      init: async () => "r2",
    });

    const app = defineResource({
      id: "circular.app",
      register: [r1, r2],
    });

    await expect(run(app, { dryRun: true })).rejects.toThrow(
      /Circular dependencies detected/,
    );
  });

  it("e) depending on an unregistered item throws on run()", async () => {
    const dep = defineResource({ id: "missing.dep", init: async () => "x" });
    const app = defineResource({
      id: "unregistered.dependency.app",
      // Don't register dep on purpose, but depend on it
      dependencies: { dep },
      async init(_, { dep }) {
        return dep;
      },
    });

    await expect(run(app)).rejects.toThrow(/Dependency .*missing.dep/);
  });
});
