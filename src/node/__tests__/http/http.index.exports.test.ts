import { httpMixedClientFactory, httpSmartClientFactory } from "../../http";

describe("node http index exports", () => {
  it("exports node HTTP client factory resources", () => {
    expect(httpSmartClientFactory.id).toBe(
      "globals.resources.httpSmartClientFactory",
    );
    expect(httpMixedClientFactory.id).toBe(
      "globals.resources.httpMixedClientFactory",
    );
  });
});
