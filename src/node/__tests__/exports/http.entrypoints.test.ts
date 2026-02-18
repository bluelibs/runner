import {
  createHttpMixedClient as createHttpMixedClientFromHttp,
  createHttpSmartClient as createHttpSmartClientFromHttp,
} from "../../http";
import {
  createHttpMixedClient as createHttpMixedClientFromNode,
  createHttpSmartClient as createHttpSmartClientFromNode,
} from "../../node";

describe("Node HTTP Entrypoints", () => {
  it("re-exports smart/mixed client creators from node and node/http entrypoints", () => {
    expect(typeof createHttpSmartClientFromHttp).toBe("function");
    expect(typeof createHttpMixedClientFromHttp).toBe("function");
    expect(createHttpSmartClientFromNode).toBe(createHttpSmartClientFromHttp);
    expect(createHttpMixedClientFromNode).toBe(createHttpMixedClientFromHttp);
  });
});
