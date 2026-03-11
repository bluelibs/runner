import {
  defineAsyncContext,
  getCurrentStore,
} from "../../definers/defineAsyncContext";

describe("defineAsyncContext direct exports", () => {
  it("covers defineAsyncContext function", () => {
    const C = defineAsyncContext<string>({ id: "direct-ctx" });
    expect(C.id).toBeDefined();
  });

  it("returns undefined from getCurrentStore when no context is active", () => {
    expect(getCurrentStore()).toBeUndefined();
  });
});
