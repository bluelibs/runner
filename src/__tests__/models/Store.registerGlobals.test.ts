import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { createTestFixture } from "../test-utils";

describe("Store framework bootstrap defensive guard", () => {
  it("silently skips framework resource value binding when a built-in resource entry is missing", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);
    const runtimeResult = fixture.createRuntimeResult(taskRunner);

    jest.spyOn(store.resources, "get").mockImplementation((resourceId) => {
      if (resourceId === "system.store") {
        return undefined;
      }

      return Map.prototype.get.call(store.resources, resourceId);
    });

    const root = defineResource({ id: "store-guard-root" });
    store.initializeStore(root, {}, runtimeResult);

    expect(store.resources.has("system.store")).toBe(true);
  });

  it("registers framework resources under the system and runner namespaces", () => {
    const fixture = createTestFixture();
    const { store } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    store.initializeStore(
      defineResource({ id: "store-owner-root" }),
      {},
      fixture.createRuntimeResult(taskRunner),
    );

    expect(store.getOwnerResourceId(globalResources.store.id)).toBe("system");
    expect(store.getOwnerResourceId(globalResources.runtime.id)).toBe("system");
    expect(store.getOwnerResourceId(globalResources.mode.id)).toBe("runner");
    expect(store.getOwnerResourceId(globalResources.health.id)).toBe("runner");
    expect(store.getOwnerResourceId(globalResources.logger.id)).toBe("runner");
    expect(store.getOwnerResourceId(globalResources.queue.id)).toBe("runner");
  });
});
