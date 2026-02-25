import { defineResource } from "../../define";
import { run } from "../../run";

enum ResourceId {
  App = "app",
  ContextConfig = "resource.context.config",
}

enum ConfigMode {
  Fast = "fast",
}

enum CleanupToken {
  Task1 = "task1",
}

describe("provides context for config resources without init and uses it in dispose", () => {
  it("provides context for config resources without init and uses it in dispose", async () => {
    let disposeContext: { cleanup: CleanupToken[] } | undefined;

    const contextResource = defineResource<{ mode: ConfigMode }, Promise<void>>(
      {
        id: ResourceId.ContextConfig,
        context: () => ({ cleanup: [CleanupToken.Task1] }),
        dispose: async (_value, _config, _deps, context) => {
          disposeContext = context;
        },
      },
    );

    const app = defineResource({
      id: ResourceId.App,
      register: [contextResource.with({ mode: ConfigMode.Fast })],
      dependencies: { contextResource },
      init: async () => undefined,
    });

    const result = await run(app);
    await result.dispose();

    expect(disposeContext).toEqual({ cleanup: [CleanupToken.Task1] });
  });

  it("passes config/deps/context to cooldown and dispose for config-only resources", async () => {
    let cooldownCall:
      | {
          value: unknown;
          config: { mode: ConfigMode };
          deps: Record<string, unknown>;
          context: { cleanup: CleanupToken[]; cooled: boolean };
        }
      | undefined;
    let disposeCall:
      | {
          value: unknown;
          config: { mode: ConfigMode };
          deps: Record<string, unknown>;
          context: { cleanup: CleanupToken[]; cooled: boolean };
        }
      | undefined;

    const appResource = defineResource({
      id: "resource.context.config.dependency",
      async init() {
        return "dependency";
      },
    });

    const contextResource = defineResource<
      { mode: ConfigMode },
      Promise<void>,
      { appResource: typeof appResource }
    >({
      id: "resource.context.config.cooldown",
      dependencies: { appResource },
      context: () => ({ cleanup: [CleanupToken.Task1], cooled: false }),
      cooldown: async (value, config, deps, context) => {
        context.cooled = true;
        cooldownCall = { value, config, deps, context };
      },
      dispose: async (value, config, deps, context) => {
        disposeCall = { value, config, deps, context };
      },
    });

    const app = defineResource({
      id: ResourceId.App,
      register: [appResource, contextResource.with({ mode: ConfigMode.Fast })],
      dependencies: { contextResource },
      init: async () => undefined,
    });

    const result = await run(app);
    await result.dispose();

    expect(cooldownCall).toMatchObject({
      value: undefined,
      config: { mode: ConfigMode.Fast },
      deps: { appResource: "dependency" },
      context: { cleanup: [CleanupToken.Task1], cooled: true },
    });
    expect(disposeCall).toMatchObject({
      value: undefined,
      config: { mode: ConfigMode.Fast },
      deps: { appResource: "dependency" },
      context: { cleanup: [CleanupToken.Task1], cooled: true },
    });
  });

  it("passes empty dependencies object to cooldown when no dependencies are declared", async () => {
    let seenDeps: Record<string, unknown> | undefined;

    const contextResource = defineResource<{ mode: ConfigMode }, Promise<void>>(
      {
        id: "resource.context.config.cooldown.no-deps",
        context: () => ({ cleanup: [CleanupToken.Task1], cooled: false }),
        cooldown: async (_value, _config, deps, context) => {
          context.cooled = true;
          seenDeps = deps;
        },
      },
    );

    const app = defineResource({
      id: ResourceId.App,
      register: [contextResource.with({ mode: ConfigMode.Fast })],
      dependencies: { contextResource },
      init: async () => undefined,
    });

    const result = await run(app);
    await result.dispose();

    expect(seenDeps).toEqual({});
  });
});
