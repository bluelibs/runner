import {
  cacheMiddleware,
  journalKeys,
} from "../../globals/middleware/cache.middleware";

describe("cache middleware coverage", () => {
  it("keeps raw task ids unchanged when no canonical task marker is present", async () => {
    const get = jest.fn(async () => undefined);
    const set = jest.fn(async () => undefined);
    const journal = {
      set: jest.fn(),
    };
    const next = jest.fn(async () => "fresh-value");
    const rawTaskId = "raw-task-id";

    const result = await cacheMiddleware.run!(
      {
        task: {
          definition: { id: rawTaskId },
          input: { ok: true },
        } as never,
        next,
        journal: journal as never,
      },
      {
        cache: {
          map: new Map([[rawTaskId, { get, set }]]),
          pendingCreates: new Map(),
          defaultOptions: {},
        },
        logger: undefined,
      } as never,
      {},
    );

    expect(result).toBe("fresh-value");
    expect(next).toHaveBeenCalledWith({ ok: true });
    expect(get).toHaveBeenCalledWith(`${rawTaskId}-{"ok":true}`);
    expect(set).toHaveBeenCalledWith(
      `${rawTaskId}-{"ok":true}`,
      "fresh-value",
      {
        refs: [],
      },
    );
    expect(journal.set).toHaveBeenCalledWith(journalKeys.hit, false, {
      override: true,
    });
  });
});
