import * as nodeExports from "../../index";

describe("no../../index.ts exports", () => {
  it("exports Node APIs without blanket root re-exports", () => {
    expect(typeof (nodeExports as any).nodeExposure).toBe("object");
    expect(typeof (nodeExports as any).run).toBe("function");
    expect((nodeExports as any).tag).toBeUndefined();
  });

  it("re-exports createHttpSmartClient and is callable", () => {
    const fn = (nodeExports as any).createHttpSmartClient;
    expect(typeof fn).toBe("function");
    const client = fn({ baseUrl: "http://localhost:0" });
    expect(typeof client.task).toBe("function");
  });
});
