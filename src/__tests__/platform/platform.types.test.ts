import {
  isBrowser,
  isEdge,
  isNode,
  isUniversal,
  isWebWorker,
} from "../../platform/types";

describe("platform types", () => {
  it("guards are functions", () => {
    expect(typeof isBrowser).toBe("function");
    expect(typeof isNode).toBe("function");
    expect(typeof isEdge).toBe("function");
    expect(typeof isWebWorker).toBe("function");
    expect(typeof isUniversal).toBe("function");
  });
});
