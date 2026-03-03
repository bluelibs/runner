import * as root from "../../index";

describe("package root exports coverage", () => {
  it("exposes all expected root exports", () => {
    const functionType = typeof root.task;
    // Access all named exports to trigger any getter-based re-exports
    expect(root.globals).toBeDefined();
    expect(typeof root.task).toBe("function");
    expect(typeof root.resource).toBe("function");
    expect(typeof root.event).toBe("function");
    expect(typeof root.eventLane).toBe("function");
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
    expect(typeof root.r.eventLane).toBe("function");
    expect(typeof root.r.hook).toBe("function");
    expect(typeof root.r.tag).toBe("function");
    expect(typeof root.r.override).toBe(functionType);
    expect(typeof root.r.middleware.task).toBe("function");
    expect(typeof root.r.middleware.resource).toBe("function");
    expect(typeof root.r.system.events.ready).toBe("object");
    expect(typeof root.r.system.tags.internal).toBe("object");
    expect(typeof root.r.runner.middleware.task.retry).toBe("object");
    expect(typeof root.r.runner.tags.cron).toBe("object");
    expect(typeof root.r.debug.levels.verbose).toBe("object");
    expect(root.r.system.events).toBe(root.system.events);
    expect(root.r.system.tags.internal).toBe(root.system.tags.internal);
    expect(root.r.runner.middleware).toBe(root.runner.middleware);
    expect(root.r.runner.tags).toBe(root.runner.tags);
    expect(root.r.debug.levels).toBe(root.debug.levels);

    // Additional explicit exports
    expect(root.definitions).toBeDefined();
    expect(root.Errors).toBeDefined();
    expect(root.Serializer).toBeDefined();
    expect(typeof root.Serializer).toBe("function");
    expect(root.SymbolPolicy).toBeDefined();
    expect(typeof root.SymbolPolicy).toBe("object");
    expect(root.SymbolPolicyErrorMessage).toBeDefined();
    expect(typeof root.SymbolPolicyErrorMessage).toBe("object");
    expect(root.LogPrinter).toBeDefined();
    expect(typeof root.LogPrinter).toBe("function");
    expect(typeof root.check).toBe("function");
    expect(typeof root.Match).toBe("object");
    expect(root.PlatformAdapter).toBeDefined();
    expect(typeof root.setPlatform).toBe("function");
  });
});
