import { CONTRACT } from "../../types/contracts";

describe("contracts symbol", () => {
  it("exposes the runtime unique symbol", () => {
    expect(typeof CONTRACT).toBe("symbol");
  });
});
