import { executionTrackerResource } from "../../../globals/resources/debug/executionTracker.resource";
import { globalTags } from "../../../globals/globalTags";

describe("runner.debug.executionTracker", () => {
  it("short-circuits system resources in the resource interceptor", async () => {
    let resourceInterceptor: any;

    const deps = {
      logger: {
        info: jest.fn(async () => undefined),
        error: jest.fn(async () => undefined),
      },
      debugConfig: "verbose" as const,
      taskRunner: {
        intercept: jest.fn(),
      },
      middlewareManager: {
        intercept: jest.fn((_kind: string, interceptor: unknown) => {
          resourceInterceptor = interceptor;
        }),
      },
    };

    await (executionTrackerResource.init as any)(undefined, deps);

    const result = await resourceInterceptor(async () => "ok", {
      resource: {
        definition: {
          id: "tests.debug.system.resource",
          tags: [globalTags.system],
        },
        config: {},
      },
    });

    expect(result).toBe("ok");
    expect(deps.logger.info).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("logs resource initialization errors and rethrows them", async () => {
    let resourceInterceptor: any;
    const originalError = new Error("resource-boom");

    const deps = {
      logger: {
        info: jest.fn(async () => undefined),
        error: jest.fn(async () => undefined),
      },
      debugConfig: "verbose" as const,
      taskRunner: {
        intercept: jest.fn(),
      },
      middlewareManager: {
        intercept: jest.fn((_kind: string, interceptor: unknown) => {
          resourceInterceptor = interceptor;
        }),
      },
    };

    await (executionTrackerResource.init as any)(undefined, deps);

    await expect(
      resourceInterceptor(
        async () => {
          throw originalError;
        },
        {
          resource: {
            definition: {
              id: "tests.debug.non-system.resource",
              tags: [],
            },
            config: { value: 1 },
          },
        },
      ),
    ).rejects.toThrow("resource-boom");

    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("preserves original resource error when logger.error fails", async () => {
    let resourceInterceptor: any;
    const originalError = new Error("resource-original");

    const deps = {
      logger: {
        info: jest.fn(async () => undefined),
        error: jest.fn(async () => {
          throw new Error("logger-failed");
        }),
      },
      debugConfig: "verbose" as const,
      taskRunner: {
        intercept: jest.fn(),
      },
      middlewareManager: {
        intercept: jest.fn((_kind: string, interceptor: unknown) => {
          resourceInterceptor = interceptor;
        }),
      },
    };

    await (executionTrackerResource.init as any)(undefined, deps);

    await expect(
      resourceInterceptor(
        async () => {
          throw originalError;
        },
        {
          resource: {
            definition: {
              id: "tests.debug.non-system.resource.logger-fails",
              tags: [],
            },
            config: {},
          },
        },
      ),
    ).rejects.toThrow("resource-original");
  });
});
