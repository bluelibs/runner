import { defineTask } from "../define";

describe("main exports", () => {
  it("should export all public APIs correctly", async () => {
    // Test main index exports for 100% coverage
    const mainExports = await import("../index");

    expect(typeof mainExports.task).toBe("function");
    expect(typeof mainExports.resource).toBe("function");
    expect(typeof mainExports.resourceMiddleware).toBe("function");
    expect(typeof mainExports.taskMiddleware).toBe("function");
    expect(typeof mainExports.event).toBe("function");
    expect(typeof mainExports.hook).toBe("function");
    expect(typeof mainExports.tag).toBe("function");
    expect(typeof mainExports.run).toBe("function");
    expect(typeof mainExports.createContext).toBe("function");
    expect(typeof mainExports.globals).toBe("object");
    expect(typeof mainExports.definitions).toBe("object");
    expect(typeof mainExports.Store).toBe("function");
    expect(typeof mainExports.EventManager).toBe("function");
    expect(typeof mainExports.TaskRunner).toBe("function");
    expect(typeof mainExports.Queue).toBe("function");
    expect(typeof mainExports.Semaphore).toBe("function");
    expect(typeof mainExports.GraphSerializer).toBe("function");
    expect(typeof mainExports.EJSON).toBe("object");
    expect(typeof mainExports.PlatformAdapter).toBe("function");

    // Test that aliases work the same as direct imports
    const directTask = defineTask({ id: "test", run: async () => "direct" });
    const aliasTask = mainExports.task({
      id: "test2",
      run: async () => "alias",
    });

    expect(directTask.id).toBe("test");
    expect(aliasTask.id).toBe("test2");

    // Test tag exports work
    const testTag = mainExports.tag<{ value: number }>({ id: "test.tag" });
    const testTag2 = mainExports.tag<{ name: string }>({ id: "test.tag2" });

    expect(testTag.id).toBe("test.tag");
    expect(testTag2.id).toBe("test.tag2");
    expect(typeof testTag.with).toBe("function");
    expect(typeof testTag2.extract).toBe("function");

    // Test createContext export
    const TestContext = mainExports.createContext<string>("test.context");
    expect(typeof TestContext.provide).toBe("function");
    expect(typeof TestContext.use).toBe("function");

    // Test globals sub-properties for complete coverage
    expect(typeof mainExports.globals.events).toBe("object");
    expect(typeof mainExports.globals.resources).toBe("object");
    expect(typeof mainExports.globals.middleware).toBe("object");
  });
});
