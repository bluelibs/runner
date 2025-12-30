import { createContext } from "../definers/defineAsyncContext";

describe("defineAsyncContext direct createContext", () => {
  it("covers createContext function", () => {
    const C = createContext<string>("direct.ctx");
    expect(C.id).toBeDefined();
  });
});
