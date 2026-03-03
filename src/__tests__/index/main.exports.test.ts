import { defineTask } from "../../define";
import * as mainExports from "../../index";

describe("main exports", () => {
  it("should export all public APIs correctly", () => {
    // Test main index exports for 100% coverage

    expect(typeof mainExports.task).toBe("function");
    expect(typeof mainExports.resource).toBe("function");
    expect(typeof mainExports.resourceMiddleware).toBe("function");
    expect(typeof mainExports.taskMiddleware).toBe("function");
    expect(typeof mainExports.event).toBe("function");
    expect(typeof mainExports.hook).toBe("function");
    expect(typeof mainExports.rpcLane).toBe("function");
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
    expect(typeof mainExports.Serializer).toBe("function");
    expect(typeof mainExports.SymbolPolicy).toBe("object");
    expect(typeof mainExports.SymbolPolicyErrorMessage).toBe("object");
    expect(typeof mainExports.LogPrinter).toBe("function");
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

    // Test namespaced sub-properties for complete coverage
    expect(typeof mainExports.system.runtime).toBe("object");
    expect(typeof mainExports.system.events.ready).toBe("object");
    expect(typeof mainExports.system.tags.internal).toBe("object");
    expect(typeof mainExports.runner.middleware).toBe("object");
    expect(typeof mainExports.runner.tags).toBe("object");
    expect(typeof mainExports.debug.levels).toBe("object");
    expect(typeof (mainExports.r as any).rpcLane).toBe("function");
    expect(typeof (mainExports.r as any).system.eventManager).toBe("object");
    expect(typeof (mainExports.r as any).system.events.ready).toBe("object");
    expect(typeof (mainExports.r as any).system.tags.internal).toBe("object");
    expect(typeof (mainExports.r as any).runner.cron).toBe("object");
    expect(typeof (mainExports.r as any).runner.middleware.task).toBe("object");
    expect(typeof (mainExports.r as any).runner.tags.cron).toBe("object");
    expect(typeof (mainExports.r as any).debug.levels.normal).toBe("object");
    expect((mainExports.r as any).system).toBe(mainExports.system);
    expect((mainExports.r as any).runner).toBe(mainExports.runner);
    expect((mainExports.r as any).system.events).toBe(
      mainExports.system.events,
    );
    expect((mainExports.r as any).runner.middleware).toBe(
      mainExports.runner.middleware,
    );
    expect((mainExports.r as any).runner.tags).toBe(mainExports.runner.tags);
    expect((mainExports.r as any).system.tags.internal).toBe(
      mainExports.system.tags.internal,
    );
    expect((mainExports.r as any).debug.levels).toBe(mainExports.debug.levels);
  });
});
