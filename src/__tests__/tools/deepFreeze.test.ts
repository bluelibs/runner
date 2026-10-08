import { deepFreeze, freezeIfLineageLocked } from "../../tools/deepFreeze";

class MutableBox {
  value = 0;
}

describe("deepFreeze", () => {
  it("reuses completed shared graphs without walking them again", () => {
    let reads = 0;
    const shared = new Proxy(
      { nested: { value: 1 } },
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    deepFreeze(shared);
    const afterFirst = reads;
    deepFreeze({ shared });
    deepFreeze({ box: new MutableBox(), shared });
    deepFreeze(shared);
    expect(reads).toBe(afterFirst);
    expect(Object.isFrozen(shared.nested)).toBe(true);
  });

  it("still traverses shallow-frozen objects", () => {
    const nested = { value: 1 };
    deepFreeze(Object.freeze({ nested }));
    expect(Object.isFrozen(nested)).toBe(true);
  });

  it("does not cache partial cyclic traversals after a freezing error", () => {
    const root: { child?: object; failure?: object } = {};
    const child = { root };
    root.child = child;
    // Fail after a child was frozen with a back-reference to the mutable root.
    const failure = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("interrupted");
        },
      },
    );
    root.failure = failure;
    expect(() => deepFreeze(root)).toThrow("interrupted");
    delete root.failure;
    deepFreeze(child);
    expect(Object.isFrozen(root)).toBe(true);
  });

  it("preserves caller-supplied traversal exclusions", () => {
    const excluded = { value: 1 };
    const root = { excluded };
    deepFreeze(root, new WeakSet([excluded]));
    expect(Object.isFrozen(excluded)).toBe(false);
    deepFreeze(root);
    expect(Object.isFrozen(excluded)).toBe(true);
  });

  it("does not cache cycles when Object.freeze itself fails", () => {
    let fail = true;
    const target: { child?: object } = {};
    const root = new Proxy(target, {
      preventExtensions(object) {
        if (fail) return false;
        return Reflect.preventExtensions(object);
      },
    });
    const child = { root };
    target.child = child;
    expect(() => deepFreeze(root)).toThrow(TypeError);
    expect(Object.isFrozen(child)).toBe(true);
    expect(Object.isFrozen(root)).toBe(false);
    fail = false;
    deepFreeze(child);
    expect(Object.isFrozen(root)).toBe(true);
  });

  it("bypasses memoization when the caller supplies traversal state", () => {
    let reads = 0;
    const root = new Proxy(
      {},
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    deepFreeze(root);
    const afterDefault = reads;
    const seen = new WeakSet<object>();
    deepFreeze(root, seen);
    expect(reads).toBeGreaterThan(afterDefault);
    expect(seen.has(root)).toBe(true);
    const afterExplicit = reads;
    deepFreeze(root, new WeakSet([root]));
    expect(reads).toBe(afterExplicit);
  });

  it("can freeze an opaque root previously skipped as a nested instance", () => {
    const box = new MutableBox();
    deepFreeze({ box });
    expect(Object.isFrozen(box)).toBe(false);
    deepFreeze(box);
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("revisits an opaque descendant after it becomes a plain object", () => {
    const box = new MutableBox();
    const root = { box };
    deepFreeze(root);
    Object.setPrototypeOf(box, Object.prototype);
    deepFreeze(root);
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("does not cache cycles pointing into a graph with an opaque boundary", () => {
    const box = new MutableBox();
    const root: { child?: object; box?: MutableBox } = {};
    const child = { root };
    root.child = child;
    root.box = box;
    deepFreeze(root);
    Object.setPrototypeOf(box, Object.prototype);
    deepFreeze(child);
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("returns primitives as-is", () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze("x")).toBe("x");
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(undefined)).toBeUndefined();
  });

  it("deep-freezes plain object graphs and handles cycles", () => {
    const payload: {
      nested: { list: number[] };
      self?: unknown;
    } = {
      nested: { list: [1, 2, 3] },
    };
    payload.self = payload;

    const frozen = deepFreeze(payload);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.list)).toBe(true);
  });

  it("treats null-prototype objects as plain and freezes them", () => {
    const nullProto = Object.create(null) as { flag?: boolean };
    nullProto.flag = true;

    const frozen = deepFreeze({ nullProto });
    expect(Object.isFrozen(frozen.nullProto)).toBe(true);
  });

  it("skips freezing nested non-plain instances", () => {
    const box = new MutableBox();
    const frozen = deepFreeze({ box });

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.box)).toBe(false);

    frozen.box.value = 10;
    expect(frozen.box.value).toBe(10);
  });

  it("handles getter-only accessor descriptors (no set)", () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "getterOnly", {
      configurable: true,
      get() {
        return 42;
      },
    });
    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it("handles setter-only accessor descriptors (no get)", () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "setterOnly", {
      configurable: true,
      set(_v: unknown) {
        /* noop */
      },
    });
    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it("walks accessor descriptors and tolerates missing descriptors", () => {
    const target: Record<string, unknown> = { ghost: "gone-later" };
    Object.defineProperty(target, "computed", {
      configurable: true,
      enumerable: true,
      get() {
        return "ok";
      },
      set(_value: string) {},
    });

    let ownKeysCalls = 0;
    const proxy = new Proxy(target, {
      ownKeys() {
        ownKeysCalls += 1;
        if (ownKeysCalls === 1) {
          return ["computed", "ghost"];
        }
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "computed") {
          delete target.ghost;
        }
        if (key === "ghost") {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    const frozen = deepFreeze(proxy);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});

describe("freezeIfLineageLocked", () => {
  it("freezes only when source is already frozen", () => {
    const unlockedSource = {};
    const unlockedTarget = { ok: true };
    const unlockedResult = freezeIfLineageLocked(
      unlockedSource,
      unlockedTarget,
    );
    expect(Object.isFrozen(unlockedResult)).toBe(false);

    const lockedSource = Object.freeze({});
    const lockedTarget = { ok: true };
    const lockedResult = freezeIfLineageLocked(lockedSource, lockedTarget);
    expect(Object.isFrozen(lockedResult)).toBe(true);
  });

  it("returns target unchanged when source is not object-like", () => {
    const target = { ok: true };
    const result = freezeIfLineageLocked("not-object", target);
    expect(result).toBe(target);
    expect(Object.isFrozen(result)).toBe(false);
  });
});
