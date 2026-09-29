import { r } from "../../..";
import { ScopedResourceOverrides } from "../../../models/overrides/ScopedResourceOverrides";
import { StoreRegistry } from "../../../models/store/StoreRegistry";
import { OverrideManager } from "../../../models/OverrideManager";
import { createTestFixture } from "../../test-utils";

describe("ScopedResourceOverrides compilation", () => {
  it("selects the nearest declaration even when candidates arrive descendant-first", () => {
    const registry = new StoreRegistry(createTestFixture().store);
    const service = r
      .resource("service")
      .init(async () => "base")
      .build();
    const read = r
      .task("read")
      .dependencies({ service })
      .run(async (_, deps) => deps.service)
      .build();
    const child = r.resource("child").register([read]).build();
    registry.computeRegistrationDeeply(
      r.resource("app").register([service, child]).build(),
    );
    const record = jest.fn();
    const compiler = new ScopedResourceOverrides(registry, record);
    compiler.add("app.service", [
      {
        source: "app.child",
        override: r.override(service, async () => "child"),
      },
      { source: "app", override: r.override(service, async () => "root") },
    ]);
    compiler.compile();
    expect(record).toHaveBeenCalledWith(
      "app.service",
      "app.service",
      "app",
      expect.anything(),
    );
    expect(
      registry.tasks.get("app.child.tasks.read")?.task.dependencies,
    ).toEqual({
      service: registry.resources.get(
        "app.child.resources.overrides.app.service",
      )?.resource,
    });
  });

  it("supports a resource override supplied through the existing store override map", () => {
    const registry = new StoreRegistry(createTestFixture().store);
    const service = r
      .resource("service")
      .init(async () => "base")
      .build();
    registry.storeResource(service);
    const manager = new OverrideManager(registry);
    const replacement = r.override(service, async () => "replacement");
    manager.overrides.set(service.id, replacement);
    manager.processOverrides();
    expect(registry.resources.get(service.id)?.resource.init).toBe(
      replacement.init,
    );
  });
});
