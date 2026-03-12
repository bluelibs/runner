import { Match, MatchError, check } from "../../tools/check";

describe("tools/check Match.WithMessage aggregate behavior", () => {
  it("keeps the aggregate summary for sibling field wrappers", () => {
    try {
      check(
        {
          first: 1,
          second: 2,
        } as any,
        {
          first: Match.WithMessage(String, {
            error: "first must be a string",
          }),
          second: Match.WithMessage(String, {
            error: "second must be a string",
          }),
        },
        { throwAllErrors: true },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.message).toBe(
        "Match failed with 2 errors:\n- Expected string, got number at $.first.\n- Expected string, got number at $.second.",
      );
      expect(matchError.failures).toHaveLength(2);
    }
  });

  it.each([
    {
      label: "optional subtree",
      pattern: Match.WithMessage(
        Match.Optional(Match.ObjectIncluding({ name: String })),
        { error: "optional child is invalid" },
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "optional child is invalid",
    },
    {
      label: "maybe subtree",
      pattern: Match.WithMessage(
        Match.Maybe(Match.ObjectStrict({ name: String })),
        {
          error: "maybe child is invalid",
        },
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "maybe child is invalid",
    },
    {
      label: "lazy subtree",
      pattern: Match.WithMessage(
        Match.Lazy(() => Match.ObjectIncluding({ name: String })),
        { error: "lazy child is invalid" },
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

        return Match.WithMessage(Match.fromSchema(ChildSchema), {
          error: "class child is invalid",
        });
      })(),
      value: { name: 42 },
      path: "$.child.name",
      message: "class child is invalid",
    },
    {
      label: "map subtree",
      pattern: Match.WithMessage(Match.MapOf(String), {
        error: "map is invalid",
      }),
      value: { one: 1 },
      path: "$.child.one",
      message: "map is invalid",
    },
    {
      label: "non-empty array subtree",
      pattern: Match.WithMessage(Match.NonEmptyArray(String), {
        error: "list is invalid",
      }),
      value: [1],
      path: "$.child[0]",
      message: "list is invalid",
    },
    {
      label: "object constructor subtree",
      pattern: Match.WithMessage(Object, {
        error: "object is invalid",
      }),
      value: 1,
      path: "$.child",
      message: "object is invalid",
    },
    {
      label: "array literal subtree",
      pattern: Match.WithMessage([String], {
        error: "array is invalid",
      }),
      value: [1],
      path: "$.child[0]",
      message: "array is invalid",
    },
    {
      label: "plain object subtree",
      pattern: Match.WithMessage(
        { name: String },
        {
          error: "plain object is invalid",
        },
      ),
      value: { name: 42 },
      path: "$.child.name",
      message: "plain object is invalid",
    },
  ])(
    "keeps subtree wrappers as aggregate headlines for $label",
    ({ pattern, value, path, message }) => {
      try {
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
        );
        throw new Error("Expected MatchError");
      } catch (error) {
        expect(error).toBeInstanceOf(MatchError);
        const matchError = error as MatchError;
        expect(matchError.message).toBe(message);
        expect(matchError.failures).toHaveLength(2);
        expect(matchError.failures[0].path).toBe(path);
        expect(matchError.failures[1].path).toBe("$.title");
      }
    },
  );
});
