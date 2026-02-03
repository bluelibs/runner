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
});
