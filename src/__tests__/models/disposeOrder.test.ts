import { defineResource } from "../../define";
import { getResourcesInDisposeOrder } from "../../models/utils/disposeOrder";
import { createTestFixture } from "../test-utils";

describe("disposeOrder options", () => {
  it("uses default options when omitted", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const resource = defineResource({ id: "dispose.options.default" });
    store.storeGenericItem(resource);
    store.resources.get(resource.id)!.isInitialized = true;
    store.recordResourceInitialized(resource.id);

    const result = getResourcesInDisposeOrder(store.resources, [
      resource.id,
    ]).map((entry) => entry.resource.id);

    expect(result).toEqual([resource.id]);
  });

  it("supports explicit disable of init-order fast path", () => {
    const fixture = createTestFixture();
    const { store } = fixture;

    const dep = defineResource({ id: "dispose.options.dep" });
    const app = defineResource({
      id: "dispose.options.app",
      dependencies: { dep },
    });

    store.storeGenericItem(dep);
    store.storeGenericItem(app);
    store.resources.get(dep.id)!.isInitialized = true;
    store.resources.get(app.id)!.isInitialized = true;

    const result = getResourcesInDisposeOrder(
      store.resources,
      [app.id, dep.id],
      { preferInitOrderFastPath: false },
    ).map((entry) => entry.resource.id);

    expect(result).toEqual([app.id, dep.id]);
  });
});
