import { cancellationError, isCancellationError } from "../errors";

describe("errors.isCancellationError", () => {
  it("returns true for CancellationError instance", () => {
    let inst: any;
    try {
      cancellationError.throw({});
    } catch (e) {
      inst = e;
    }
    expect(isCancellationError(inst)).toBe(true);
  });
  it("returns false for non-cancellation error", () => {
    expect(isCancellationError(new Error("x"))).toBe(false);
  });
  it("returns false for undefined/null and false for plain object without brand", () => {
    expect(isCancellationError(undefined)).toBe(false);
    expect(isCancellationError(null as unknown as Error)).toBe(false);
    expect(
      isCancellationError({ name: "CancellationError" } as unknown as Error),
    ).toBe(false);
  });
});
