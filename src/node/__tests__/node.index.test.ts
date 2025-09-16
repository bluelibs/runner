import * as nodeExports from "../index";

describe("node/index.ts exports", () => {
  it("re-exports nodeExposure from node and main APIs from root", () => {
    expect(typeof (nodeExports as any).nodeExposure).toBe("object");
    // smoke-check a root export exists too (tag builder)
    expect(typeof (nodeExports as any).tag).toBe("function");
  });
});
