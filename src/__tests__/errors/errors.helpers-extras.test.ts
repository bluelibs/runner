import {
  contextError,
  resourceNotFoundError,
  platformUnsupportedFunctionError,
  dependencyNotFoundError,
  duplicateRegistrationError,
  validationError,
} from "../../errors";

describe("error helpers extra branches", () => {
  it("contextError default message branch", () => {
    try {
      // no details -> uses fallback branch
      contextError.throw({});
      fail("Expected throw");
    } catch (e: any) {
      expect(String(e?.message)).toContain("Context error");
    }
  });

  it("resourceNotFoundError message", () => {
    try {
      resourceNotFoundError.throw({ id: "x" });
      fail("Expected throw");
    } catch (e: any) {
      expect(String(e?.message)).toContain('Resource "x" not found.');
    }
  });

  it("platformUnsupportedFunctionError smoke", () => {
    try {
      platformUnsupportedFunctionError.throw({ functionName: "testFn" });
      fail("Expected throw");
    } catch (e: any) {
      expect(String(e?.message)).toContain("Platform function not supported");
    }
  });

  describe("remediation in framework errors", () => {
    it("includes remediation advice in the message", () => {
      try {
        dependencyNotFoundError.throw({ key: "myService" });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.message).toContain("Dependency myService not found");
        expect(e.message).toContain("Remediation:");
        expect(e.remediation).toContain("myService");
      }
    });

    it("includes static remediation when data is not referenced", () => {
      try {
        contextError.throw({});
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain("async context");
      }
    });

    it("includes data-dependent remediation for duplicateRegistration", () => {
      try {
        duplicateRegistrationError.throw({ type: "Task", id: "test.task" });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain("Task");
        expect(e.remediation).toContain(".fork()");
      }
    });

    it("validationError remediation suggests inputSchema for input subjects", () => {
      try {
        validationError.throw({
          subject: "Task input",
          id: "t1",
          originalError: "bad",
        });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain(".inputSchema()");
      }
    });

    it("validationError remediation suggests configSchema for config subjects", () => {
      try {
        validationError.throw({
          subject: "Resource config",
          id: "r1",
          originalError: "bad",
        });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain(".configSchema()");
      }
    });

    it("validationError remediation suggests resultSchema for result subjects", () => {
      try {
        validationError.throw({
          subject: "Task result",
          id: "t2",
          originalError: "bad",
        });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain(".resultSchema()");
      }
    });

    it("validationError remediation falls back to schema for other subjects", () => {
      try {
        validationError.throw({
          subject: "Event payload",
          id: "e1",
          originalError: "bad",
        });
        fail("Expected throw");
      } catch (e: any) {
        expect(e.remediation).toContain(".schema()");
        expect(e.remediation).not.toContain("inputSchema");
        expect(e.remediation).not.toContain("configSchema");
        expect(e.remediation).not.toContain("resultSchema");
      }
    });
  });
});
