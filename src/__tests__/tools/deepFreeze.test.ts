import { deepFreeze, freezeIfLineageLocked } from "../../tools/deepFreeze";

class MutableBox {
  value = 0;
}

describe("deepFreeze", () => {
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
