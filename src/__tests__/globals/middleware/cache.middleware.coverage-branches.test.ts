import { cacheMiddleware } from "../../../globals/middleware/cache.middleware";
import type { ICacheProvider } from "../../../globals/middleware/cache.resource";

describe("cache middleware coverage branches", () => {
  it("keeps task ids unchanged when they do not include canonical `.tasks.` marker", async () => {
    const keyBuilder = jest.fn(() => "cache-key");
    const cacheInstance: ICacheProvider = {
      get: jest.fn(async () => undefined),
      has: jest.fn(async () => false),
      set: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
      invalidateRefs: jest.fn(async () => 0),
    };
    const cache = {
      map: new Map([["legacy-task-id", cacheInstance]]),
      pendingCreates: new Map(),
      defaultOptions: {},
    };
    const next = jest.fn(async (input: unknown) => ({ input }));
    const journal = { set: jest.fn() };

    const result = await cacheMiddleware.run(
      {
        task: {
          definition: { id: "legacy-task-id" },
          input: { payload: "ok" },
        },
        next,
        journal,
      } as any,
      { cache, logger: undefined } as any,
      { keyBuilder } as any,
    );

    expect(result).toEqual({ input: { payload: "ok" } });
    expect(keyBuilder).toHaveBeenCalledWith("legacy-task-id", {
      payload: "ok",
    });
    expect(next).toHaveBeenCalledWith({ payload: "ok" });
  });
});
