import { CanonicalIdCompiler } from "../../../models/store-registry/CanonicalIdCompiler";
import { RegisterableKind } from "../../../models/store-registry/registerableKind";

describe("CanonicalIdCompiler", () => {
  const compiler = new CanonicalIdCompiler();

  it("preserves ids that are already prefixed with the owner resource id", () => {
    expect(
      compiler.compute(
        {
          resourceId: "runner",
          usesFrameworkRootIds: false,
        },
        RegisterableKind.Resource,
        "runner.health",
      ),
    ).toBe("runner.health");
  });
});
