import {
  cacheMiddleware,
  journalKeys,
  resolveCacheMiddlewareConfig,
} from "../../globals/middleware/cache.middleware";
import { defaultStorageTaskKeyBuilder } from "../../globals/middleware/keyBuilder.shared";
import { Serializer } from "../../serializer";

describe("cache middleware coverage", () => {
  it("falls back to the default key builder when config explicitly sets keyBuilder to undefined", () => {
    const resolved = resolveCacheMiddlewareConfig(
      {
        keyBuilder: undefined,
        ttl: 123,
      },
      {
        allowStale: true,
      },
    );

    expect(resolved.cacheOptions).toEqual({
      allowStale: true,
      max: 100,
      ttl: 123,
      ttlAutopurge: true,
    });
    expect(resolved.keyBuilder("task", { ok: true })).toBe('task:{"ok":true}');
  });

  it("passes the runtime task id to custom key builders", () => {
    const resolved = resolveCacheMiddlewareConfig(
      {
        keyBuilder: (taskId) => taskId,
      },
      {},
    );

    expect(resolved.keyBuilder("app.tasks.lookup", { ok: true })).toBe(
      "app.tasks.lookup",
    );
  });

  it("falls back to the raw task id when the storage helper is unavailable", () => {
    expect(defaultStorageTaskKeyBuilder("task-id", undefined)).toBe("task-id");
  });

  it("fails fast when the default key builder cannot serialize input", () => {
    const resolved = resolveCacheMiddlewareConfig(undefined, {});

    expect(() =>
      resolved.keyBuilder("task", {
        fn: () => true,
      }),
    ).toThrow(/serializable input/i);
  });

  it("surfaces non-Error serialization failures from the default key builder", () => {
    const resolved = resolveCacheMiddlewareConfig(undefined, {});
    const stringifySpy = jest
      .spyOn(Serializer.prototype, "stringify")
      .mockImplementation(() => {
        throw "plain-string-failure";
      });

    try {
      expect(() => resolved.keyBuilder("task", { ok: true })).toThrow(
        /plain-string-failure/,
      );
    } finally {
      stringifySpy.mockRestore();
    }
  });

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
    expect(get).toHaveBeenCalledWith(`${rawTaskId}:{"ok":true}`);
    expect(set).toHaveBeenCalledWith(
      `${rawTaskId}:{"ok":true}`,
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
