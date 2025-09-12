import { nodeOnlyTag } from "../../node";

describe("Node subpath export", () => {
  it("exports nodeOnlyTag and metadata", () => {
    expect(nodeOnlyTag).toBeDefined();
    expect(nodeOnlyTag.id).toBe("platform.node.only");
    // exercise methods to count coverage
    const configured = nodeOnlyTag.with({});
    expect(configured.id).toBe("platform.node.only");
    expect(nodeOnlyTag.meta?.title).toBe("Node-Only");
  });
});

