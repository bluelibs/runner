import type { CheckSchemaLike, MatchJsonSchema } from "../..";
import { check, errors } from "../..";
import { Match } from "../../decorators/legacy";

describe("CheckSchemaLike boundaries", () => {
  const stepRangeSchema: CheckSchemaLike<number> = {
    parse(input: unknown): number {
      const value = Number(input);

      if (value > 10) {
        throw errors.matchError.new({
          path: "$",
          failures: [
            {
              path: "$",
              expected: "number <= 10",
              actualType: "number",
              message: "Expected number <= 10.",
            },
          ],
        });
      }

      return value;
    },
    toJSONSchema(): MatchJsonSchema {
      return {
        type: "number",
        maximum: 10,
      };
    },
  };

  it("keeps $ rooted to the schema-like value itself at top level", () => {
    try {
      check(11, stepRangeSchema);
      throw new Error("Expected matchError");
    } catch (error) {
      expect(errors.matchError.is(error)).toBe(true);
      expect(error).toMatchObject({
        id: errors.matchError.id,
      });
      expect((error as { data?: { path?: string } }).data?.path).toBe("$");
    }
  });

  it("does not support schema-like objects as nested raw Match patterns", () => {
    expect(() =>
      check({ stepRange: 11 }, { stepRange: stepRangeSchema as never }),
    ).toThrow("Expected plain object, got number at $.stepRange.");
  });

  it("does not support schema-like objects in Match.Field()", () => {
    class Config {
      stepRange!: number;
    }

    Match.Schema()(Config);
    Match.Field(stepRangeSchema as never)(Config.prototype, "stepRange");

    expect(() => Match.fromSchema(Config).parse({ stepRange: 11 })).toThrow(
      "Expected plain object, got number at $.stepRange.",
    );
  });
});
