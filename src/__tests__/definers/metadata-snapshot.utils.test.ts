import { snapshotMetadata } from "../../definers/builders/shared/snapshotMetadata";

describe("metadata container cloning", () => {
  it("preserves opaque instances and functions without cloning their state", () => {
    const date = new Date();
    const callback = () => 1;
    const metadata = snapshotMetadata({ date, callback, value: null });
    expect(metadata.date).toBe(date);
    expect(metadata.callback).toBe(callback);
    expect(metadata.value).toBeNull();
  });

  it("preserves symbols, null prototypes, sharing, and accessors without invoking them", () => {
    const key = Symbol("metadata");
    const nested = { label: "shared" };
    const getter = jest.fn(() => "computed");
    const original = Object.create(null, {
      first: { value: nested, enumerable: true },
      second: { value: nested },
      computed: { get: getter },
      [key]: { value: [nested] },
    });
    const copy = snapshotMetadata(original);
    expect(getter).not.toHaveBeenCalled();
    expect(Object.getPrototypeOf(copy)).toBeNull();
    expect(copy.first).not.toBe(nested);
    expect(copy.second).toBe(copy.first);
    expect(copy[key][0]).toBe(copy.first);
    expect(copy.computed).toBe("computed");
    expect(Object.getOwnPropertyDescriptor(copy, "second")?.enumerable).toBe(
      false,
    );
  });
});
