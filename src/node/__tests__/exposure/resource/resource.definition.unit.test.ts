import { rpcExposure } from "../testkit/rpcExposure";

describe("rpcExposure test harness definition (unit)", () => {
  it("exposes a with() factory", () => {
    expect(typeof rpcExposure.with).toBe("function");
  });
});
