import { CanonicalIdCompiler } from "../../../../models/store/store-registry/CanonicalIdCompiler";
import { createOwnerScope } from "../../../../models/store/store-registry/OwnerScope";
import { RegisterableKind } from "../../../../models/store/store-registry/registerableKind";

describe("CanonicalIdCompiler", () => {
  const compiler = new CanonicalIdCompiler();

  it("preserves ids that are already prefixed with the owner resource id", () => {
    expect(
      compiler.compute(
        createOwnerScope("runner"),
        RegisterableKind.Resource,
        "runner.health",
      ),
    ).toBe("runner.health");
  });

  it("rejects a qualified id from another owner at the local-id boundary", () => {
    expect(() =>
      compiler.compute(
        createOwnerScope("app"),
        RegisterableKind.Task,
        "other.tasks.create-user",
      ),
    ).toThrow(/Local id .* cannot contain/i);
  });
});
