import {
  normalizeCacheKeys,
  normalizeCacheKeyBuilderResult,
  normalizeCacheRefs,
} from "../../../../globals/middleware/cache/key";

describe("cache.key", () => {
  it("normalizes cache keys and rejects non-string values", () => {
    expect(normalizeCacheKeys(undefined)).toEqual([]);
    expect(normalizeCacheKeys(["user:1", "user:1"])).toEqual(["user:1"]);

    expect(() => normalizeCacheKeys(["user:1", 42 as never])).toThrow(
      /cache keys must be strings/i,
    );
  });

  it("normalizes cache refs and rejects non-string values", () => {
    expect(normalizeCacheRefs(undefined)).toEqual([]);
    expect(normalizeCacheRefs(["user:1", "user:1"])).toEqual(["user:1"]);

    expect(() => normalizeCacheRefs(["user:1", 42 as never])).toThrow(
      /cache refs must be strings/i,
    );
  });

  it("normalizes structured keyBuilder results and fails fast on invalid payloads", () => {
    expect(normalizeCacheKeyBuilderResult("user:1")).toEqual({
      cacheKey: "user:1",
      refs: [],
    });
    expect(
      normalizeCacheKeyBuilderResult({
        cacheKey: "user:1:full",
        refs: ["user:1", "user:1"],
      }),
    ).toEqual({
      cacheKey: "user:1:full",
      refs: ["user:1"],
    });

    expect(() =>
      normalizeCacheKeyBuilderResult({ cacheKey: 123 as never }),
    ).toThrow(/string cacheKey/i);
    expect(() => normalizeCacheKeyBuilderResult([] as never)).toThrow(
      /must return a string or/i,
    );
  });
});
