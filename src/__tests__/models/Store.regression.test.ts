import { defineResource } from "../../define";
import { createTestFixture } from "../test-utils";

enum ResourceId {
  Root = "store.regression.root",
}

describe("Store regressions", () => {
  it("fails fast when taskRunner is missing during initialization", () => {
    const { store } = createTestFixture();
    const root = defineResource({
      id: ResourceId.Root,
      init: async () => "root",
    });

    expect(() => store.initializeStore(root, {})).toThrow(
      /TaskRunner is not set/i,
    );
  });
});
