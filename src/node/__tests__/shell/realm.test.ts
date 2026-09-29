import { runInNewContext } from "node:vm";
import { check } from "../../../tools/check";
import { isPlainObject } from "../../../tools/typeChecks";

describe("shell input realms", () => {
  it("validates nested object literals created by another JavaScript realm", () => {
    const input: unknown = runInNewContext(
      '({ amount: 2, details: { label: "shell" }, items: [{ value: 1 }] })',
    );
    expect(isPlainObject(input)).toBe(true);
    expect(() =>
      check(input, {
        amount: Number,
        details: { label: String },
        items: [{ value: Number }],
      }),
    ).not.toThrow();
  });

  it.each([
    "new (class Example {})()",
    "new Date()",
    "Object.create({})",
    "Object.create(Object.create(null))",
    "Object.create(Object.assign(Object.create(null), { constructor: 1 }))",
    "Object.create(Object.assign(Object.create(null), { constructor: Object }))",
    "(() => { function Fake() {} Object.setPrototypeOf(Fake.prototype, null); return new Fake(); })()",
  ])("rejects a foreign non-plain object: %s", (source) => {
    expect(isPlainObject(runInNewContext(source))).toBe(false);
  });

  it("does not inspect a spoofed constructor's prototype", () => {
    const get = jest.fn();
    const constructor = new Proxy(function Fake() {}, { get });
    const prototype = Object.assign(Object.create(null), { constructor });
    expect(isPlainObject(Object.create(prototype))).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("does not execute a constructor getter while checking a foreign prototype", () => {
    const getter = jest.fn(() => Object);
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "constructor", { get: getter });
    expect(isPlainObject(Object.create(prototype))).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
});
