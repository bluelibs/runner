import { r } from "../../index";
import { run } from "../../run";

enum ResourceId {
  Broken = "broken.resource",
  BrokenWithMeta = "broken.resource.meta",
  Root = "root",
  Task = "task",
  Resource = "res",
}

enum ErrorMessage {
  Boom = "boom",
  WithResource = "broken.resource.meta boom",
}

describe("DependencyProcessor Consistency", () => {
  it("should rethrow non-Error resource init failures with a helpful message", async () => {
    const broken = r
      .resource(ResourceId.Broken)
      .init(async () => {
        throw ErrorMessage.Boom;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    await expect(run(root)).rejects.toThrow(
      /Resource "broken\.resource" initialization failed: boom/,
    );
  });

  it("should annotate Error failures with resourceId and cause", async () => {
    const error = new Error(ErrorMessage.Boom);
    const broken = r
      .resource(ResourceId.Broken)
      .init(async () => {
        throw error;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    let caught: unknown;
    try {
      await run(root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const caughtError = caught as Error;
    expect(caughtError.message).toContain(ResourceId.Broken);
    expect(Reflect.get(caughtError, "resourceId")).toBe(ResourceId.Broken);
    expect(Reflect.get(caughtError, "cause")).toEqual({
      resourceId: ResourceId.Broken,
    });
  });

  it("should keep existing resourceId and cause when present", async () => {
    const error = new Error(ErrorMessage.WithResource);
    Object.defineProperty(error, "resourceId", {
      value: ResourceId.BrokenWithMeta,
      configurable: true,
    });
    Object.defineProperty(error, "cause", {
      value: { resourceId: ResourceId.BrokenWithMeta },
      configurable: true,
    });

    const broken = r
      .resource(ResourceId.BrokenWithMeta)
      .init(async () => {
        throw error;
      })
      .build();

    const root = r
      .resource(ResourceId.Root)
      .register([broken])
      .init(async () => "root")
      .build();

    let caught: unknown;
    try {
      await run(root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const caughtError = caught as Error;
    expect(caughtError.message).toBe(ErrorMessage.WithResource);
    expect(Reflect.get(caughtError, "resourceId")).toBe(
      ResourceId.BrokenWithMeta,
    );
    expect(Reflect.get(caughtError, "cause")).toEqual({
      resourceId: ResourceId.BrokenWithMeta,
    });
  });

  // Regression test for: https://github.com/bluelibs/runner/issues/BUG-ID-OR-CONTEXT
  it("should preserve task wrapper identity between injection and storage", async () => {
    const task = r
      .task(ResourceId.Task)
      .run(async () => "bar")
      .build();

    const resource = r
      .resource(ResourceId.Resource)
      .dependencies({ task })
      .init(async (_config, { task }) => {
        return { task };
      })
      .build();

    // Root depends on resource to force earlier initialization, which previously triggered the inconsistency
    const root = r
      .resource(ResourceId.Root)
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
