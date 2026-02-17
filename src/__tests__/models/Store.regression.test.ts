import { defineResource } from "../../define";
import { RunResult } from "../../models";
import { createTestFixture } from "../test-utils";

enum ResourceId {
  Root = "store.regression.root",
}

describe("Store regressions", () => {
  it("fails fast when taskRunner is missing during initialization", () => {
    const { store, logger, eventManager, createTaskRunner } =
      createTestFixture();
    const runtimeResult = new RunResult<unknown>(
      logger,
      store,
      eventManager,
      createTaskRunner(),
      async () => store.dispose(),
    );
    const root = defineResource({
      id: ResourceId.Root,
      init: async () => "root",
    });

    expect(() => store.initializeStore(root, {}, runtimeResult)).toThrow(
      /TaskRunner is not set/i,
    );
  });
});
