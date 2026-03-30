import { resolveHttpError } from "../../../../examples/express-openapi-sqlite/src/app/http/utils/http-error";

const { errors } =
  require("@bluelibs/runner") as typeof import("../../../../src");

describe("resolveHttpError", () => {
  it("keeps known 4xx runner errors intact", () => {
    const validationError = errors.validationError.new({
      subject: "Task input",
      id: "users.create",
      originalError: new Error("email is invalid"),
    });
    const matchError = errors.matchError.new({
      path: "$",
      failures: [],
    });

    expect(resolveHttpError(validationError)).toEqual({
      statusCode: 400,
      message: "email is invalid",
    });

    expect(resolveHttpError(matchError)).toEqual({
      statusCode: 400,
      message: "Match failed at $.",
    });
  });

  it("hides unexpected server errors behind a generic message", () => {
    expect(resolveHttpError(new Error("database connection failed"))).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
  });
});
