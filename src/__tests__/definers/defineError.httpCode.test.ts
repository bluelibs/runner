import { defineError } from "../../definers/defineError";

describe("defineError httpCode", () => {
  it("exposes httpCode on helper and thrown error", () => {
    const E = defineError<{ code: number; message: string }>({
      id: "tests.errors.define.httpCode",
      httpCode: 422,
      format: (d) => d.message,
    });

    expect(E.httpCode).toBe(422);

    try {
      E.throw({ code: 1, message: "bad" });
      fail("Expected throw");
    } catch (err) {
      if (!E.is(err)) {
        fail("Expected typed error");
      }
      expect(err.httpCode).toBe(422);
      expect(err.message).toBe("bad");
    }
  });

  it("throws for invalid httpCode", () => {
    expect(() =>
      defineError({
        id: "tests.errors.define.invalidHttpCode",
        httpCode: 700,
      }),
    ).toThrow(/httpCode must be an integer between 100 and 599/i);
  });
});
