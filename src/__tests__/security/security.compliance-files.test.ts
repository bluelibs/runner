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
    expect(fs.existsSync(path.join(root, "SECURITY.md"))).toBe(true);
  });
});
