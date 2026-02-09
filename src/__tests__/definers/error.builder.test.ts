import { definitions, r, RunnerError } from "../..";

describe("error builder", () => {
  it("build() returns an ErrorHelper that can throw and type-narrow via is()", () => {
    const AppError = r
      .error<{ code: number; message: string }>("tests.errors.app")
      .dataSchema({
        parse(input: unknown) {
          const d = input as { code: number; message: string };
          if (typeof d?.code !== "number" || typeof d?.message !== "string") {
            throw new Error("invalid");
          }
          return d;
        },
      })
      .serialize((d) => JSON.stringify(d))
      .parse((s) => JSON.parse(s))
      .build();

    try {
      AppError.throw({ code: 123, message: "Boom" });
      fail("Expected throw to raise");
    } catch (err) {
      expect(AppError.is(err)).toBe(true);
      if (!AppError.is(err)) {
        throw err;
      }
      if (!(err instanceof Error)) {
        throw new Error("Expected an Error instance");
      }
      // Name and message should reflect id and data.message
      expect(err.name).toBe("tests.errors.app");
      expect(err.message).toBe('{"code":123,"message":"Boom"}');
      expect(err.toString()).toBe(
        'tests.errors.app: {"code":123,"message":"Boom"}',
      );
    }
  });

  it("is() narrows unknown to a typed runner error shape", () => {
    const E = r
      .error<{ code: number }>("tests.errors.narrowing")
      .format((d) => `Code: ${d.code}`)
      .remediation("Use a valid code.")
      .build();

    try {
      E.throw({ code: 7 });
      fail("Expected throw");
    } catch (err: unknown) {
      if (!E.is(err)) fail("Expected typed error");
      const code: number = err.data.code;
      const remediation: string | undefined = err.remediation;

      expect(code).toBe(7);
      expect(remediation).toBe("Use a valid code.");
    }
  });

  it("validates data via dataSchema.parse before throwing", () => {
    const TypedError = r
      .error<{ code: number; message: string }>("tests.errors.typed")
      .dataSchema({
        parse(input: unknown) {
          const d = input as { code: number; message: string };
          if (typeof d?.code !== "number" || typeof d?.message !== "string") {
            throw new Error("invalid");
          }
          return d;
        },
      })
      .build();

    const bad: any = { code: "x", message: 1 };
    expect(() => TypedError.throw(bad)).toThrow("invalid");
  });

  it("accepts format in builder chain (smoke)", () => {
    const E = r
      .error<{ message: string }>("tests.errors.display")
      .format((d) => d.message)
      .build();
    try {
      E.throw({ message: "hi" });
    } catch (err) {
      expect(E.is(err)).toBe(true);
    }
  });

  it("accepts meta in builder chain (smoke)", () => {
    const E = r
      .error<{ message: string }>("tests.errors.meta")
      .meta({ title: "Test Error", description: "A test error" })
      .build();
    try {
      E.throw({ message: "test" });
    } catch (err) {
      expect(E.is(err)).toBe(true);
    }
  });

  it("captures symbolFilePath from the caller location", () => {
    const E = r.error<{ message: string }>("tests.errors.filePath").build();

    expect(
      (E as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toBeDefined();
    expect(
      (E as unknown as Record<symbol, any>)[definitions.symbolFilePath],
    ).toContain("error.builder.test");
  });

  it("supports httpCode in builder and exposes it on helper and thrown error", () => {
    const E = r
      .error<{ reason: string }>("tests.errors.httpCode")
      .httpCode(404)
      .format((d) => d.reason)
      .build();

    expect(E.httpCode).toBe(404);

    try {
      E.throw({ reason: "missing" });
      fail("Expected throw");
    } catch (err) {
      if (!E.is(err)) {
        fail("Expected typed error");
      }
      expect(err.httpCode).toBe(404);
      expect(err.message).toBe("missing");
    }
  });

  it("fails fast when httpCode is below range", () => {
    expect(() => r.error("tests.errors.httpCode.low").httpCode(99)).toThrow(
      /httpCode must be an integer between 100 and 599/i,
    );
  });

  it("fails fast when httpCode is above range", () => {
    expect(() => r.error("tests.errors.httpCode.high").httpCode(600)).toThrow(
      /httpCode must be an integer between 100 and 599/i,
    );
  });

  it("fails fast when httpCode is not an integer", () => {
    expect(() =>
      r.error("tests.errors.httpCode.float").httpCode(400.5),
    ).toThrow(/httpCode must be an integer between 100 and 599/i);
  });

  describe("remediation", () => {
    it("appends static remediation advice to message and toString()", () => {
      const E = r
        .error<{ code: number }>("tests.errors.remediation.static")
        .format((d) => `Error code ${d.code}`)
        .remediation("Try restarting the service.")
        .build();

      try {
        E.throw({ code: 42 });
        fail("Expected throw");
      } catch (err) {
        expect(E.is(err)).toBe(true);
        if (!(err instanceof Error)) throw new Error("Expected Error");
        expect(err.message).toBe(
          "Error code 42\n\nRemediation: Try restarting the service.",
        );
        expect(err.toString()).toBe(
          "tests.errors.remediation.static: Error code 42\n\nRemediation: Try restarting the service.",
        );
      }
    });

    it("supports data-dependent remediation function", () => {
      const E = r
        .error<{ field: string }>("tests.errors.remediation.dynamic")
        .format((d) => `Missing field: ${d.field}`)
        .remediation((d) => `Provide the "${d.field}" field in your input.`)
        .build();

      try {
        E.throw({ field: "email" });
        fail("Expected throw");
      } catch (err) {
        if (!(err instanceof Error)) throw new Error("Expected Error");
        expect(err.message).toContain("Missing field: email");
        expect(err.message).toContain(
          'Remediation: Provide the "email" field in your input.',
        );
      }
    });

    it("omits remediation from message when not provided", () => {
      const E = r
        .error<{ code: number }>("tests.errors.remediation.none")
        .format((d) => `Error ${d.code}`)
        .build();

      try {
        E.throw({ code: 1 });
        fail("Expected throw");
      } catch (err) {
        if (!(err instanceof Error)) throw new Error("Expected Error");
        expect(err.message).toBe("Error 1");
        expect(err.message).not.toContain("Remediation");
      }
    });

    it("exposes remediation as a property on the thrown error", () => {
      const E = r
        .error<{ code: number }>("tests.errors.remediation.prop")
        .format((d) => `Error ${d.code}`)
        .remediation("Check the logs.")
        .build();

      try {
        E.throw({ code: 99 });
        fail("Expected throw");
      } catch (err: any) {
        expect(err.remediation).toBe("Check the logs.");
      }
    });

    it("remediation property is undefined when not provided", () => {
      const E = r
        .error<{ code: number }>("tests.errors.remediation.undefined")
        .format((d) => `Error ${d.code}`)
        .build();

      try {
        E.throw({ code: 1 });
        fail("Expected throw");
      } catch (err: any) {
        expect(err.remediation).toBeUndefined();
      }
    });

    it("appends remediation label even when remediation is an empty string", () => {
      const E = r
        .error<{ code: number }>("tests.errors.remediation.empty")
        .format((d) => `Error ${d.code}`)
        .remediation("")
        .build();

      try {
        E.throw({ code: 5 });
        fail("Expected throw");
      } catch (err) {
        if (!(err instanceof Error)) throw new Error("Expected Error");
        expect(err.message).toBe("Error 5\n\nRemediation: ");
      }
    });
  });

  describe("r.error.is() static method", () => {
    it("detects any Runner error regardless of specific type", () => {
      const ErrorA = r
        .error<{ code: number }>("tests.errors.static.is.a")
        .build();
      const ErrorB = r
        .error<{ message: string }>("tests.errors.static.is.b")
        .build();

      let caughtA: unknown;
      let caughtB: unknown;

      try {
        ErrorA.throw({ code: 42 });
      } catch (err) {
        caughtA = err;
      }

      try {
        ErrorB.throw({ message: "oops" });
      } catch (err) {
        caughtB = err;
      }

      // Both should be detected as Runner errors
      expect(r.error.is(caughtA)).toBe(true);
      expect(r.error.is(caughtB)).toBe(true);

      // Type narrowing works
      if (r.error.is(caughtA)) {
        expect(caughtA.id).toBe("tests.errors.static.is.a");
        expect(caughtA.name).toBe("tests.errors.static.is.a");
      }

      if (r.error.is(caughtB)) {
        expect(caughtB.id).toBe("tests.errors.static.is.b");
        expect(caughtB.name).toBe("tests.errors.static.is.b");
      }
    });

    it("returns false for non-Runner errors", () => {
      const standardError = new Error("standard");
      const typeError = new TypeError("type error");
      const customError = class CustomError extends Error {};

      expect(r.error.is(standardError)).toBe(false);
      expect(r.error.is(typeError)).toBe(false);
      expect(r.error.is(new customError("custom"))).toBe(false);
      expect(r.error.is(null)).toBe(false);
      expect(r.error.is(undefined)).toBe(false);
      expect(r.error.is("string")).toBe(false);
      expect(r.error.is(123)).toBe(false);
      expect(r.error.is({})).toBe(false);
    });

    it("narrows to RunnerError type with accessible properties", () => {
      const E = r
        .error<{ field: string }>("tests.errors.static.is.narrow")
        .httpCode(400)
        .format((d) => `Invalid ${d.field}`)
        .remediation("Provide a valid field.")
        .build();

      try {
        E.throw({ field: "email" });
        fail("Expected throw");
      } catch (err) {
        if (r.error.is(err)) {
          // TypeScript should recognize these properties
          expect(err.id).toBe("tests.errors.static.is.narrow");
          expect(err.name).toBe("tests.errors.static.is.narrow");
          expect(err.httpCode).toBe(400);
          expect(err.remediation).toBe("Provide a valid field.");
          expect(err.message).toContain("Invalid email");
          expect(err.data).toBeDefined();
        } else {
          fail("Expected RunnerError");
        }
      }
    });

    it("works with RunnerError class directly for instanceof checks", () => {
      const E = r
        .error<{ code: number }>("tests.errors.static.is.instanceof")
        .build();

      try {
        E.throw({ code: 123 });
      } catch (err) {
        expect(err instanceof RunnerError).toBe(true);
        expect(r.error.is(err)).toBe(true);
      }
    });

    it("can be used to filter mixed error types", () => {
      const AppError = r
        .error<{ code: number }>("tests.errors.static.is.filter")
        .build();

      const errors: unknown[] = [
        new Error("standard"),
        (() => {
          try {
            AppError.throw({ code: 1 });
          } catch (e) {
            return e;
          }
        })(),
        new TypeError("type"),
        (() => {
          try {
            AppError.throw({ code: 2 });
          } catch (e) {
            return e;
          }
        })(),
      ];

      const runnerErrors = errors.filter(r.error.is);

      expect(runnerErrors).toHaveLength(2);
      expect(runnerErrors[0].id).toBe("tests.errors.static.is.filter");
      expect(runnerErrors[1].id).toBe("tests.errors.static.is.filter");
    });
  });
});
