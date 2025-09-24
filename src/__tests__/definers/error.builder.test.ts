import { r } from "../..";

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
      if (AppError.is(err)) {
        // Name and message should reflect id and data.message
        expect(err.name).toBe("tests.errors.app");
        expect(err.message).toBe("Boom");
        expect(AppError.toString(err)).toBe("Boom");
      }
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
    expect(() => TypedError.throw(bad)).toThrowError("invalid");
  });
});
