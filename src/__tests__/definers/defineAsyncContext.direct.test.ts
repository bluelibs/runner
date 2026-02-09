import {
  createContext,
  getCurrentStore,
} from "../../definers/defineAsyncContext";

describe("defineAsyncContext direct createContext", () => {
  it("covers createContext function", () => {
    const C = createContext<string>("direct.ctx");
    expect(C.id).toBeDefined();
  });

  it("returns undefined from getCurrentStore when no context is active", () => {
    expect(getCurrentStore()).toBeUndefined();
  });
});
