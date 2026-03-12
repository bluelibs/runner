import { matchError } from "../../errors/foundation/match.errors";
import { Match, check } from "../../tools/check";

function expectMatchFailure(
  run: () => unknown,
): ReturnType<typeof matchError.new> {
  try {
    run();
    throw new Error("Expected match error");
  } catch (error) {
    expect(matchError.is(error)).toBe(true);
    return error as ReturnType<typeof matchError.new>;
  }
}

describe("tools/check Match.WithMessage aggregate behavior", () => {
  it("keeps the aggregate summary for sibling field wrappers", () => {
    const error = expectMatchFailure(() =>
      check(
        {
          first: 1,
          second: 2,
        } as any,
        {
          first: Match.WithMessage(String, "first must be a string"),
          second: Match.WithMessage(String, "second must be a string"),
        },
        { throwAllErrors: true },
      ),
    );

    expect(error.message).toContain(
      "Match failed with 2 errors:\n- Expected string, got number at $.first.\n- Expected string, got number at $.second.",
    );
    expect(error.data.failures).toHaveLength(2);
  });

  it.each([
    {
      label: "optional subtree",
      pattern: Match.WithMessage(
        Match.Optional(Match.ObjectIncluding({ name: String })),
        "optional child is invalid",
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "optional child is invalid",
    },
    {
      label: "maybe subtree",
      pattern: Match.WithMessage(
        Match.Maybe(Match.ObjectStrict({ name: String })),
        "maybe child is invalid",
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "maybe child is invalid",
    },
    {
      label: "lazy subtree",
      pattern: Match.WithMessage(
        Match.Lazy(() => Match.ObjectIncluding({ name: String })),
        "lazy child is invalid",
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "lazy child is invalid",
    },
    {
      label: "class schema subtree",
      pattern: (() => {
        class ChildSchema {
          public name!: string;
        }

        Match.Schema()(ChildSchema);
        Match.Field(String)(ChildSchema.prototype, "name");

        return Match.WithMessage(
          Match.fromSchema(ChildSchema),
          "class child is invalid",
        );
      })(),
      value: { name: 42 },
      path: "$.child.name",
      message: "class child is invalid",
    },
    {
      label: "map subtree",
      pattern: Match.WithMessage(Match.MapOf(String), "map is invalid"),
      value: { one: 1 },
      path: "$.child.one",
      message: "map is invalid",
    },
    {
      label: "non-empty array subtree",
      pattern: Match.WithMessage(
        Match.NonEmptyArray(String),
        "list is invalid",
      ),
      value: [1],
      path: "$.child[0]",
      message: "list is invalid",
    },
    {
      label: "object constructor subtree",
      pattern: Match.WithMessage(Object, "object is invalid"),
      value: 1,
      path: "$.child",
      message: "object is invalid",
    },
    {
      label: "array literal subtree",
      pattern: Match.WithMessage([String], "array is invalid"),
      value: [1],
      path: "$.child[0]",
      message: "array is invalid",
    },
    {
      label: "plain object subtree",
      pattern: Match.WithMessage({ name: String }, "plain object is invalid"),
      value: { name: 42 },
      path: "$.child.name",
      message: "plain object is invalid",
    },
  ])(
    "keeps subtree wrappers as aggregate headlines for $label",
    ({ pattern, value, path, message }) => {
      const error = expectMatchFailure(() =>
        check(
          {
            child: value,
            title: 1,
          } as any,
          {
            child: pattern,
            title: String,
          },
          { throwAllErrors: true },
        ),
      );

      expect(error.message).toBe(message);
      expect(error.data.failures).toHaveLength(2);
      expect(error.data.failures[0].path).toBe(path);
      expect(error.data.failures[1].path).toBe("$.title");
    },
  );
});
