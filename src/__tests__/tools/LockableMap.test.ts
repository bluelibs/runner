import { LockableMap } from "../../public";

describe("LockableMap", () => {
  let map: LockableMap<string, number>;

  beforeEach(() => {
    map = new LockableMap("testMap");
  });

  // ── Unlocked behaviour ────────────────────────────────────────────

  it("should allow set/get/delete/clear while unlocked", () => {
    map.set("a", 1);
    expect(map.get("a")).toBe(1);
    expect(map.size).toBe(1);

    expect(map.delete("a")).toBe(true);
    expect(map.size).toBe(0);

    map.set("b", 2);
    map.clear();
    expect(map.size).toBe(0);
  });

  it("should report locked as false before locking", () => {
    expect(map.locked).toBe(false);
  });

  // ── Locking ───────────────────────────────────────────────────────

  it("should report locked as true after locking", () => {
    map.lock();
    expect(map.locked).toBe(true);
  });

  it("should preserve existing entries after locking", () => {
    map.set("x", 42);
    map.lock();
    expect(map.get("x")).toBe(42);
    expect(map.has("x")).toBe(true);
    expect(map.size).toBe(1);
  });

  // ── Mutation guards ───────────────────────────────────────────────

  it("should throw on set() after lock", () => {
    map.lock();
    expect(() => map.set("a", 1)).toThrow(
      'Cannot modify "testMap" — the map is locked.',
    );
  });

  it("should throw on delete() after lock", () => {
    map.set("a", 1);
    map.lock();
    expect(() => map.delete("a")).toThrow(
      'Cannot modify "testMap" — the map is locked.',
    );
  });

  it("should throw on clear() after lock", () => {
    map.lock();
    expect(() => map.clear()).toThrow(
      'Cannot modify "testMap" — the map is locked.',
    );
  });

  // ── Read-only operations remain available after lock ──────────────

  it("should allow read operations after lock", () => {
    map.set("a", 1);
    map.set("b", 2);
    map.lock();

    expect(map.get("a")).toBe(1);
    expect(map.has("b")).toBe(true);
    expect(map.size).toBe(2);
    expect([...map.keys()]).toEqual(["a", "b"]);
    expect([...map.values()]).toEqual([1, 2]);
    expect([...map.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);

    const collected: Array<[string, number]> = [];
    map.forEach((v, k) => collected.push([k, v]));
    expect(collected).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  // ── Default name ──────────────────────────────────────────────────

  it("should use a default name when none is provided", () => {
    const unnamed = new LockableMap<string, string>();
    unnamed.lock();
    expect(() => unnamed.set("x", "y")).toThrow(
      'Cannot modify "LockableMap" — the map is locked.',
    );
  });
});
