// This suite enforces presence of standard policy files used by security/compliance
// workflows. Keeping these files in the repo ensures discoverability for users
// and tooling (e.g., SECURITY.md for reporting protocols).
import * as fs from "fs";
import * as path from "path";

describe("Compliance: repository policy files", () => {
  const root = path.resolve(__dirname, "../../../");

  it("has LICENSE.md", () => {
    // License file is required for downstream consumers and legal clarity.
    expect(fs.existsSync(path.join(root, "LICENSE.md"))).toBe(true);
  });

  it("has SECURITY.md", () => {
    // SECURITY.md describes supported versions, reporting channels,
    // and CI/automation related security measures.
    const possiblePaths = [
      path.join(root, "SECURITY.md"),
      path.join(root, ".github", "SECURITY.md"),
    ];
    expect(possiblePaths.some((filePath) => fs.existsSync(filePath))).toBe(
      true,
    );
  });
});
