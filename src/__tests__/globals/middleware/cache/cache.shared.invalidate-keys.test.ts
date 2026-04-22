import { createDefaultCacheProvider } from "../../../../globals/middleware/cache/shared";

describe("cache.shared invalidateKeys", () => {
  it("invalidates exact keys and removes their ref bindings", async () => {
    const provider = createDefaultCacheProvider();
    const cache = await provider({
      taskId: "task",
      options: { max: 10 },
    });

    await cache.set("user:1:full", "A", { refs: ["user:1"] });
    await cache.set("user:1:summary", "B", { refs: ["user:1"] });
    await cache.set("plain", "C");

    expect(cache.invalidateKeys(["user:1:full", "plain", "plain"])).toBe(2);
    expect(cache.has?.("user:1:full")).toBe(false);
    expect(cache.has?.("plain")).toBe(false);
    expect(cache.has?.("user:1:summary")).toBe(true);
    expect(cache.invalidateRefs(["user:1"])).toBe(1);
  });
});
