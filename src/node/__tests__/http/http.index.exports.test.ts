import { httpMixedClientFactory, httpSmartClientFactory } from "../../http";

describe("node http index exports", () => {
  it("exports node HTTP client factory resources", () => {
    expect(httpSmartClientFactory.id).toBe(
      "runner.node.httpSmartClientFactory",
    );
    expect(httpMixedClientFactory.id).toBe(
      "runner.node.httpMixedClientFactory",
    );
  });
});
