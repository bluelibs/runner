import * as root from "../index";

describe("package root exports coverage", () => {
  it("exposes all expected root exports", () => {
    // Access all named exports to trigger any getter-based re-exports
    expect(root.globals).toBeDefined();
    expect(typeof root.task).toBe("function");
    expect(typeof root.resource).toBe("function");
    expect(typeof root.event).toBe("function");
    expect(typeof root.taskMiddleware).toBe("function");
    expect(typeof root.resourceMiddleware).toBe("function");
    expect(typeof root.tag).toBe("function");
    expect(typeof root.override).toBe("function");
    expect(typeof root.hook).toBe("function");
    expect(typeof root.run).toBe("function");
    expect(typeof root.createContext).toBe("function");
    expect(typeof root.createTestResource).toBe("function");

    // Namespaced exports
    expect(root.r).toBeDefined();
    expect(typeof root.r.task).toBe("function");
    expect(typeof root.r.resource).toBe("function");
    expect(typeof root.r.event).toBe("function");
    expect(typeof root.r.hook).toBe("function");
    expect(typeof root.r.tag).toBe("function");
    expect(typeof root.r.middleware.task).toBe("function");
    expect(typeof root.r.middleware.resource).toBe("function");

    // Additional explicit exports
    expect(root.definitions).toBeDefined();
    expect(root.Errors).toBeDefined();
    expect(root.EJSON).toBeDefined();
    expect(root.PlatformAdapter).toBeDefined();
    expect(typeof root.setPlatform).toBe("function");
  });
});
