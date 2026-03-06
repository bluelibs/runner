import { isolateExportsUnknownTargetError } from "../../errors";

describe("isolateExportsUnknownTargetError", () => {
  it("renders the unknown export target message and remediation", () => {
    expect.assertions(4);

    try {
      isolateExportsUnknownTargetError.throw({
        policyResourceId: "app.resource",
        targetId: "missing.export",
      });
      fail("Expected throw");
    } catch (error: any) {
      expect(error.message).toContain(
        'Resource "app.resource" exports unknown target "missing.export" in its isolate policy.',
      );
      expect(error.message).toContain("Remediation:");
      expect(error.remediation).toContain(
        'Register "missing.export" in the same runtime graph',
      );
      expect(error.remediation).toContain("instead of raw ids");
    }
  });
});
