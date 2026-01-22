import { r } from "../../index";
import { run } from "../../run";

describe("DependencyProcessor Consistency", () => {
  // Regression test for: https://github.com/bluelibs/runner/issues/BUG-ID-OR-CONTEXT
  it("should preserve task wrapper identity between injection and storage", async () => {
    const task = r
      .task("task")
      .run(async () => "bar")
      .build();

    const resource = r
      .resource("res")
      .dependencies({ task })
      .init(async (_config, { task }) => {
        return { task };
      })
      .build();

    // Root depends on resource to force earlier initialization, which previously triggered the inconsistency
    const root = r
      .resource("root")
      .register([task, resource])
      .dependencies({ resource })
      .init(async () => "root")
      .build();

    const runtime = await run(root);
    const resEntry = runtime.store.resources.get(resource.id);

    const injectedTask = resEntry?.value.task;
    const storedTask = (resEntry?.computedDependencies as any)?.task;

    // This ensures that the task wrapper used during initialization is the EXACT same object
    // as the one stored in computedDependencies.
    expect(injectedTask).toBeDefined();
    expect(storedTask).toBeDefined();
    expect(injectedTask).toBe(storedTask);

    await runtime.dispose();
  });
});
