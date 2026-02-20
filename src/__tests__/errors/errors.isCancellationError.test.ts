import { cancellationError } from "../../public";

describe("cancellationError.is", () => {
  it("returns true for CancellationError instance", () => {
    expect.assertions(1);

    let inst: any;
    try {
      cancellationError.throw({});
    } catch (e) {
      inst = e;
    }
    expect(cancellationError.is(inst)).toBe(true);
  });
  it("returns false for non-cancellation error", () => {
    expect(cancellationError.is(new Error("x"))).toBe(false);
  });
  it("returns false for undefined/null and false for plain object without brand", () => {
    expect(cancellationError.is(undefined)).toBe(false);
    expect(cancellationError.is(null as unknown as Error)).toBe(false);
    expect(
      cancellationError.is({ name: "CancellationError" } as unknown as Error),
    ).toBe(false);
  });
});
