import { Match, MatchError, check, type MatchPattern } from "../../tools/check";
import { RunnerError } from "../../definers/defineError";
import { getClassSchemaDefinition } from "../../tools/check/classSchema";

describe("tools/check decorators", () => {
  it("supports class + field decorators with nested arrays and bidirectional references", () => {
    class User {
      public name!: string;
      public items!: Item[];
    }

    class Item {
      public title!: string;
      public owner!: User;
    }

    Match.Class()(User);
    Match.Class()(Item);
    Match.Field(Match.NonEmptyString)(User.prototype, "name");
    Match.Field(Match.ArrayOf(Match.fromClass(Item)))(User.prototype, "items");
    Match.Field(Match.NonEmptyString)(Item.prototype, "title");
    Match.Field(Match.fromClass(User))(Item.prototype, "owner");

    const user: Record<string, unknown> = {
      name: "Ada",
      items: [
        {
          title: "Laptop",
          owner: {
            name: "Ada",
            items: [],
          },
        },
      ],
      extra: true,
    };

    expect(() => check(user, Match.fromClass(User))).not.toThrow();

    const cyclicUser: Record<string, unknown> = { name: "Ada", items: [] };
    const cyclicItem: Record<string, unknown> = {
      title: "Keyboard",
      owner: cyclicUser,
    };
    (cyclicUser.items as unknown[]).push(cyclicItem);

    expect(() => check(cyclicUser, Match.fromClass(User))).not.toThrow();
  });

  it("supports exact mode for class schemas", () => {
    class ExactUser {
      public name!: string;
    }

    Match.Class({ exact: true })(ExactUser);
    Match.Field(Match.NonEmptyString)(ExactUser.prototype, "name");

    expect(() =>
      check({ name: "Ada" }, Match.fromClass(ExactUser)),
    ).not.toThrow();
    expect(() =>
      check({ name: "Ada", extra: true }, Match.fromClass(ExactUser)),
    ).toThrow(MatchError);

    expect(() =>
      check(
        { name: "Ada", extra: true },
        Match.fromClass(ExactUser, { exact: false }),
      ),
    ).not.toThrow();

    expect(() =>
      check(
        { name: "Ada", extra: true },
        Match.fromClass(ExactUser, { exact: true }),
      ),
    ).toThrow(MatchError);

    const staticField = Match.Field(Match.Any);
    expect(() =>
      staticField(ExactUser as unknown as object, "staticValue"),
    ).not.toThrow();
  });

  it("supports Match.Lazy for recursive non-class patterns", () => {
    const getTreePattern = (): MatchPattern =>
      Match.ObjectIncluding({
        id: Match.NonEmptyString,
        children: Match.Optional(Match.ArrayOf(Match.Lazy(getTreePattern))),
      });

    const treePattern = getTreePattern();

    const value = {
      id: "root",
      children: [
        {
          id: "child",
          children: [],
        },
      ],
    };

    expect(() => check(value, treePattern)).not.toThrow();

    expect(() =>
      Match.Lazy(() => Match.NonEmptyString).parse("ok"),
    ).not.toThrow();
    expect(() =>
      Match.Lazy(() => Match.NonEmptyString).toJSONSchema(),
    ).not.toThrow();

    const cachedLazy = Match.Lazy(() => Match.NonEmptyString);
    expect(() => cachedLazy.parse("cached")).not.toThrow();
    expect(() => cachedLazy.parse("cached-again")).not.toThrow();
  });

  it("fails fast for invalid lazy and field decorator usage", () => {
    const unresolvedLazy = Match.Lazy(
      () => undefined as unknown as MatchPattern,
    );
    expect(() => check("x", unresolvedLazy)).toThrow(RunnerError);

    const selfLazy: MatchPattern = Match.Lazy(() => selfLazy);
    expect(() => check("x", selfLazy)).toThrow(RunnerError);

    const unresolvedCycle: MatchPattern = Match.Lazy(() =>
      (unresolvedCycle as { resolve: () => MatchPattern }).resolve(),
    );
    expect(() => check("x", unresolvedCycle)).toThrow(RunnerError);

    const field = Match.Field(Match.Any);
    expect(() => field({}, Symbol("x"))).toThrow(RunnerError);
    expect(() => field(Object.create(null) as never, "x")).toThrow(RunnerError);
  });

  it("supports schema id metadata and class chain safety branches", () => {
    class Base {
      public id!: string;
    }

    class Derived extends Base {
      public title!: string;
    }

    Match.Class({ schemaId: "custom.base" })(Base);
    Match.Class({ exact: true })(Derived);
    Match.Field(Match.NonEmptyString)(Base.prototype, "id");
    Match.Field(Match.NonEmptyString)(Derived.prototype, "title");

    const definition = getClassSchemaDefinition(Derived);
    expect(definition.schemaId).toBe("custom.base");
    expect(definition.exact).toBe(true);
    expect(Object.keys(definition.pattern)).toEqual(["id", "title"]);

    function BrokenConstructor(): void {
      return;
    }

    Object.defineProperty(BrokenConstructor.prototype, "constructor", {
      value: 42,
      configurable: true,
    });

    const brokenDefinition = getClassSchemaDefinition(
      BrokenConstructor as never,
    );
    expect(brokenDefinition.pattern).toEqual({});

    class PlainBase {
      public ignored!: string;
    }

    class Tracked extends PlainBase {
      public id!: string;
    }

    Match.Class()(Tracked);
    Match.Field(Match.NonEmptyString)(Tracked.prototype, "id");
    const trackedDefinition = getClassSchemaDefinition(Tracked);
    expect(Object.keys(trackedDefinition.pattern)).toEqual(["id"]);

    const anonymousTarget = function () {
      return undefined;
    };
    Object.defineProperty(anonymousTarget, "name", { value: "" });
    const anonymousDefinition = getClassSchemaDefinition(
      anonymousTarget as never,
    );
    expect(anonymousDefinition.schemaId).toBe("Anonymous");
  });
});
