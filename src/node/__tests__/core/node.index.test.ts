import * as nodeExports from "../../index";

describe("no../../index.ts exports", () => {
  it("re-exports nodeExposure from node and main APIs from root", () => {
    expect(typeof (nodeExports as any).nodeExposure).toBe("object");
    // smoke-check a root export exists too (tag builder)
    expect(typeof (nodeExports as any).tag).toBe("function");
  });

  it("re-exports createHttpSmartClient and is callable", () => {
    const fn = (nodeExports as any).createHttpSmartClient;
    expect(typeof fn).toBe("function");
    const client = fn({ baseUrl: "http://localhost:0" });
    expect(typeof client.task).toBe("function");
  });
});
