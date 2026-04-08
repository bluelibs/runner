import { cacheMiddleware } from "../../../../globals/middleware/cache/middleware";

describe("cache middleware stable task id coverage", () => {
  it("keeps plain task ids unchanged when no `.tasks.` marker exists", async () => {
    const cacheProvider = {
      get: jest.fn(async () => undefined),
      has: jest.fn(async () => false),
      set: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
      invalidateKeys: jest.fn(async () => 0),
      invalidateRefs: jest.fn(async () => 0),
    };
    const deps = {
      cache: {
        map: new Map(),
        pendingCreates: new Map(),
        cacheProvider: async () => cacheProvider,
        defaultOptions: {},
      },
      logger: undefined,
    };
    const next = jest.fn(async () => "fresh");
    const journal = {
      get: jest.fn(),
      has: jest.fn(),
      set: jest.fn(),
    };

    await cacheMiddleware.run(
      {
        task: {
          definition: { id: "plain-task-id" },
          input: { q: 1 },
        },
        next,
        journal,
      } as any,
      deps as any,
      {},
    );

    expect(deps.cache.map.has("plain-task-id")).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
