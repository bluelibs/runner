import {
  defineAsyncContext,
  getCurrentStore,
} from "../../definers/defineAsyncContext";

describe("defineAsyncContext direct exports", () => {
  it("covers defineAsyncContext function", () => {
    const C = defineAsyncContext<string>({ id: "direct-ctx" });
    expect(C.id).toBe("direct-ctx");
    expect(C.has()).toBe(false);
    expect(C.tryUse()).toBeUndefined();
  });

  it("returns undefined from getCurrentStore when no context is active", () => {
    expect(getCurrentStore()).toBeUndefined();
  });
});
