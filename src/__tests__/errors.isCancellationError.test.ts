import { CancellationError, isCancellationError } from "../errors";

describe("errors.isCancellationError", () => {
  it("returns true for CancellationError instance", () => {
    expect(isCancellationError(new CancellationError())).toBe(true);
  });
  it("returns false for non-cancellation error", () => {
    expect(isCancellationError(new Error("x"))).toBe(false);
  });
  it("returns false for undefined/null and true for plain object with matching name", () => {
    expect(isCancellationError(undefined)).toBe(false);
    expect(isCancellationError(null as unknown as Error)).toBe(false);
    expect(isCancellationError({ name: "CancellationError" } as any)).toBe(
      true,
    );
  });
});
