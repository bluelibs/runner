import * as root from "../../index";

describe("package root exports coverage", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("exposes all expected root exports", () => {
    const functionType = typeof root.defineTask;
    // Access all named exports to trigger any getter-based re-exports
    expect(typeof root.defineTask).toBe("function");
    expect(typeof root.defineResource).toBe("function");
    expect(typeof root.defineEvent).toBe("function");
    expect(typeof root.defineEventLane).toBe("function");
    expect(typeof root.defineTaskMiddleware).toBe("function");
    expect(typeof root.defineResourceMiddleware).toBe("function");
    expect(typeof root.defineTag).toBe("function");
    expect(typeof root.defineOverride).toBe("function");
    expect(typeof root.defineHook).toBe("function");
    expect(typeof root.resources).toBe("object");
    expect(typeof root.events).toBe("object");
    expect(typeof root.middleware).toBe("object");
    expect(typeof root.tags).toBe("object");
    expect(typeof root.debug).toBe("object");
    expect(typeof root.run).toBe("function");

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
    expect((root.r as any).system).toBeUndefined();
    expect((root.r as any).runner).toBeUndefined();
    expect((root.r as any).debug).toBeUndefined();
    expect(typeof root.resources.mode).toBe("object");
    expect(typeof root.resources.runtime).toBe("object");
    expect(typeof root.events.ready).toBe("object");
    expect(typeof root.middleware.task.retry).toBe("object");
    expect(typeof root.tags.system).toBe("object");
    expect(typeof root.tags.cron).toBe("object");
    expect(typeof root.debug.levels.verbose).toBe("object");

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

    // Removed legacy aliases
    expect((root as any).task).toBeUndefined();
    expect((root as any).resource).toBeUndefined();
    expect((root as any).event).toBeUndefined();
    expect((root as any).eventLane).toBeUndefined();
    expect((root as any).taskMiddleware).toBeUndefined();
    expect((root as any).resourceMiddleware).toBeUndefined();
    expect((root as any).tag).toBeUndefined();
    expect((root as any).override).toBeUndefined();
    expect((root as any).hook).toBeUndefined();
    expect((root as any).globals).toBeUndefined();
    expect((root as any).runner).toBeUndefined();
    expect((root as any).system).toBeUndefined();
    expect((root as any).asyncContexts).toBeDefined();
    expect((root as any).asyncContexts.execution.id).toBe(
      "asyncContexts.execution",
    );
  });

  it("deduplicates built-in tags when composing framework registries", () => {
    jest.isolateModules(() => {
      const { globalTags } =
        require("../../globals/globalTags") as typeof import("../../globals/globalTags");

      (
        globalTags as typeof globalTags & {
          systemDuplicate?: (typeof globalTags)[keyof typeof globalTags];
          runnerDuplicate?: (typeof globalTags)[keyof typeof globalTags];
        }
      ).systemDuplicate = globalTags.system;
      (
        globalTags as typeof globalTags & {
          systemDuplicate?: (typeof globalTags)[keyof typeof globalTags];
          runnerDuplicate?: (typeof globalTags)[keyof typeof globalTags];
        }
      ).runnerDuplicate = globalTags.debug;

      const { SYSTEM_FRAMEWORK_ITEMS, RUNNER_FRAMEWORK_ITEMS } =
        require("../../models/BuiltinsRegistry") as typeof import("../../models/BuiltinsRegistry");

      const systemTagIds = SYSTEM_FRAMEWORK_ITEMS.map((item) => item.id).filter(
        (id) => id === globalTags.system.id,
      );
      const runnerTagIds = RUNNER_FRAMEWORK_ITEMS.map((item) => item.id).filter(
        (id) => id === globalTags.debug.id,
      );

      expect(systemTagIds).toHaveLength(1);
      expect(runnerTagIds).toHaveLength(1);
    });
  });
});
