import { isBrowser, isWebWorker } from "../../platform/types";

describe("platform types", () => {
  it("guards are functions", () => {
    expect(typeof isBrowser).toBe("function");
    expect(typeof isWebWorker).toBe("function");
  });
});
