import { r } from "../../..";
import { selectOverrideCandidate } from "../../../models/overrides/selectOverrideCandidate";
import { StoreRegistry } from "../../../models/store/StoreRegistry";
import { createTestFixture } from "../../test-utils";

it("keeps the outermost test override regardless of declaration collection order", () => {
  const registry = new StoreRegistry(createTestFixture().store);
  const target = r
    .task("target")
    .run(async () => "base")
    .build();
  const child = r.resource("child").register([target]).build();
  registry.computeRegistrationDeeply(
    r.resource("app").register([child]).build(),
  );
  const parentCandidate = {
    source: "app",
    override: r.override(target, async () => "parent"),
  };
  const childCandidate = {
    source: "app.child",
    override: r.override(target, async () => "child"),
  };

  expect(
    selectOverrideCandidate(registry, [childCandidate], parentCandidate),
  ).toBe(parentCandidate);
  expect(
    selectOverrideCandidate(registry, [parentCandidate], childCandidate),
  ).toBe(parentCandidate);
});
