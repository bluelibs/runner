import { defineResource } from "../../define";
import { createTestFixture } from "../test-utils";

describe("Store registerGlobalComponents defensive guard", () => {
  it("silently skips built-in resources when storeGenericItem does not populate the map", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    // Make storeGenericItem a no-op so the resources map is never populated,
    // triggering the `if (entry)` else branch for every built-in resource.
    jest
      .spyOn(store["registry"], "storeGenericItem")
      .mockImplementation(() => undefined as any);

    const root = defineResource({ id: "store.guard.root" });
    // initializeStore calls registerGlobalComponents internally
    store.initializeStore(root, {}, runtimeResult);

    // No built-in resource entries should exist since storeGenericItem was mocked
    expect(store.resources.has("runner.store")).toBe(false);
  });
});
