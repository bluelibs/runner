import {
  contextError,
  resourceNotFoundError,
  platformUnsupportedFunctionError,
  dependencyNotFoundError,
  duplicateRegistrationError,
  validationError,
  createMessageError,
  taskRunnerNotSetError,
  queueDisposedError,
  queueDeadlockError,
  semaphoreInvalidPermitsError,
  semaphoreNonIntegerPermitsError,
  semaphoreDisposedError,
  semaphoreAcquireTimeoutError,
  journalDuplicateKeyError,
  unknownMiddlewareTypeError,
  parallelInitSchedulingError,
  platformUnreachableError,
  dashboardApiRequestError,
} from "../../errors";

describe("error helpers extra branches", () => {
  it("createMessageError preserves Error semantics", () => {
    try {
      createMessageError("boom");
      fail("Expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("Error");
      expect(e.message).toBe("boom");
    }

    try {
      createMessageError();
      fail("Expected throw");
    } catch (e: any) {
      expect(e.message).toBe("");
    }
  });

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
    it("covers new model-related error helpers", () => {
      const captureMessage = (fn: () => void): string => {
        try {
          fn();
          return "";
        } catch (e: any) {
          return String(e?.message);
        }
      };

      expect(captureMessage(() => taskRunnerNotSetError.throw({}))).toContain(
        "TaskRunner is not set",
      );
      expect(captureMessage(() => queueDisposedError.throw({}))).toContain(
        "Queue has been disposed",
      );
      expect(captureMessage(() => queueDeadlockError.throw({}))).toContain(
        "Dead‑lock detected",
      );
      expect(
        captureMessage(() =>
          semaphoreInvalidPermitsError.throw({ maxPermits: 0 }),
        ),
      ).toContain("maxPermits must be greater than 0");
      expect(
        captureMessage(() =>
          semaphoreNonIntegerPermitsError.throw({ maxPermits: 1.5 }),
        ),
      ).toContain("maxPermits must be an integer");
      expect(captureMessage(() => semaphoreDisposedError.throw({}))).toContain(
        "Semaphore has been disposed",
      );
      expect(
        captureMessage(() =>
          semaphoreAcquireTimeoutError.throw({ timeoutMs: 100 }),
        ),
      ).toContain("Semaphore acquire timeout after 100ms");
      expect(
        captureMessage(() =>
          journalDuplicateKeyError.throw({ keyId: "session.user" }),
        ),
      ).toContain('Journal key "session.user" already exists');
      expect(
        captureMessage(() => unknownMiddlewareTypeError.throw({})),
      ).toContain("Unknown middleware type");
      expect(
        captureMessage(() => parallelInitSchedulingError.throw({})),
      ).toContain("Could not schedule pending resources");
      expect(
        captureMessage(() => platformUnreachableError.throw({})),
      ).toContain("Unreachable");
      expect(
        captureMessage(() =>
          dashboardApiRequestError.throw({ message: "dashboard failed" }),
        ),
      ).toContain("dashboard failed");
    });

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
