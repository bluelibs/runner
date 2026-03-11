import { defineTask } from "../../define";
import * as mainExports from "../../index";

describe("main exports", () => {
  it("should export all public APIs correctly", () => {
    // Test main index exports for 100% coverage

    expect(typeof mainExports.defineTask).toBe("function");
    expect(typeof mainExports.defineResource).toBe("function");
    expect(typeof mainExports.defineResourceMiddleware).toBe("function");
    expect(typeof mainExports.defineTaskMiddleware).toBe("function");
    expect(typeof mainExports.defineEvent).toBe("function");
    expect(typeof mainExports.defineHook).toBe("function");
    expect(typeof mainExports.defineRpcLane).toBe("function");
    expect(typeof mainExports.defineEventLane).toBe("function");
    expect(typeof mainExports.defineTag).toBe("function");
    expect(typeof mainExports.defineOverride).toBe("function");
    expect(typeof mainExports.resources).toBe("object");
    expect(typeof mainExports.events).toBe("object");
    expect(typeof mainExports.middleware).toBe("object");
    expect(typeof mainExports.tags).toBe("object");
    expect(typeof mainExports.debug).toBe("object");
    expect(typeof mainExports.run).toBe("function");
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

    // Test that direct exports work the same as imports from define.ts
    const directTask = defineTask({ id: "test", run: async () => "direct" });
    const exportedTask = mainExports.defineTask({
      id: "test2",
      run: async () => "alias",
    });

    expect(directTask.id).toBe("test");
    expect(exportedTask.id).toBe("test2");

    // Test tag exports work
    const testTag = mainExports.defineTag<{ value: number }>({
      id: "test-tag",
    });
    const testTag2 = mainExports.defineTag<{ name: string }>({
      id: "test-tag2",
    });

    expect(testTag.id).toBe("test-tag");
    expect(testTag2.id).toBe("test-tag2");
    expect(typeof testTag.with).toBe("function");
    expect(typeof testTag2.extract).toBe("function");

    // Test namespaced sub-properties for complete coverage
    expect(typeof mainExports.resources.runtime).toBe("object");
    expect(typeof mainExports.resources.cron).toBe("object");
    expect((mainExports.resources as any).httpClientFactory).toBeUndefined();
    expect(typeof mainExports.events.ready).toBe("object");
    expect(typeof mainExports.tags.system).toBe("object");
    expect(typeof mainExports.tags.cron).toBe("object");
    expect(typeof mainExports.middleware.task.retry).toBe("object");
    expect(typeof mainExports.debug.levels.normal).toBe("object");
    expect(typeof (mainExports.r as any).rpcLane).toBe("function");
    expect(typeof (mainExports.r as any).middleware.task).toBe("function");
    expect((mainExports.r as any).system).toBeUndefined();
    expect((mainExports.r as any).runner).toBeUndefined();
    expect((mainExports.r as any).debug).toBeUndefined();
    expect((mainExports as any).task).toBeUndefined();
    expect((mainExports as any).resource).toBeUndefined();
    expect((mainExports as any).event).toBeUndefined();
    expect((mainExports as any).hook).toBeUndefined();
    expect((mainExports as any).tag).toBeUndefined();
    expect((mainExports as any).taskMiddleware).toBeUndefined();
    expect((mainExports as any).resourceMiddleware).toBeUndefined();
    expect((mainExports as any).runner).toBeUndefined();
    expect((mainExports as any).system).toBeUndefined();
    expect((mainExports as any).asyncContexts).toBeDefined();
    expect((mainExports as any).asyncContexts.execution.id).toBe(
      "asyncContexts.execution",
    );
    expect((mainExports as any).globals).toBeUndefined();
  });
});
