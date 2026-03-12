import { checkInvalidPatternError, matchError } from "../../errors";
import { RunnerError } from "../../definers/defineError";
import { Match, check, type MatchPattern } from "../../tools/check";
import { getClassSchemaDefinition } from "../../tools/check/classSchema";

function expectMatchFailure(
  run: () => unknown,
): ReturnType<typeof matchError.new> {
  try {
    run();
    throw new Error("Expected matchError");
  } catch (error) {
    expect(matchError.is(error)).toBe(true);
    return error as ReturnType<typeof matchError.new>;
  }
}

function expectInvalidPatternFailure(
  run: () => unknown,
): ReturnType<typeof checkInvalidPatternError.new> {
  try {
    run();
    throw new Error("Expected checkInvalidPatternError");
  } catch (error) {
    expect(checkInvalidPatternError.is(error)).toBe(true);
    return error as ReturnType<typeof checkInvalidPatternError.new>;
  }
}

describe("tools/check decorators", () => {
  it("keeps Class/fromClass aliases mapped to Schema/fromSchema", () => {
    expect(Match.Class).toBe(Match.Schema);
    expect(Match.fromClass).toBe(Match.fromSchema);
  });

  it("supports class + field decorators with nested arrays and bidirectional references", () => {
    class User {
      public name!: string;
      public items!: Item[];
    }

    class Item {
      public title!: string;
      public owner!: User;
    }

    Match.Schema()(User);
    Match.Schema()(Item);
    Match.Field(Match.NonEmptyString)(User.prototype, "name");
    Match.Field(Match.ArrayOf(Match.fromSchema(Item)))(User.prototype, "items");
    Match.Field(Match.NonEmptyString)(Item.prototype, "title");
    Match.Field(Match.fromSchema(User))(Item.prototype, "owner");

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

    expect(() => check(user, Match.fromSchema(User))).not.toThrow();

    const cyclicUser: Record<string, unknown> = { name: "Ada", items: [] };
    const cyclicItem: Record<string, unknown> = {
      title: "Keyboard",
      owner: cyclicUser,
    };
    (cyclicUser.items as unknown[]).push(cyclicItem);

    expect(() => check(cyclicUser, Match.fromSchema(User))).not.toThrow();
  });

  it("supports Match.fromSchema(() => Class) for self-referencing class schemas", () => {
    class User {
      public name!: string;
      public age!: number;
      public self!: User;
      public children!: User[];
    }

    Match.Schema()(User);
    Match.Field(Match.NonEmptyString)(User.prototype, "name");
    Match.Field(Match.Integer)(User.prototype, "age");
    Match.Field(Match.fromSchema(() => User))(User.prototype, "self");
    Match.Field(Match.ArrayOf(Match.fromSchema(() => User)))(
      User.prototype,
      "children",
    );

    const user: Record<string, unknown> = {
      name: "Ada",
      age: 37,
      children: [
        {
          name: "Grace",
          age: 12,
          children: [],
        },
      ],
    };
    user.self = user;
    const children = user.children as Array<Record<string, unknown>>;
    children[0].self = children[0];

    expect(() => check(user, Match.fromSchema(User))).not.toThrow();
  });

  it("supports exact mode for class schemas", () => {
    class ExactUser {
      public name!: string;
    }

    Match.Schema({ exact: true })(ExactUser);
    Match.Field(Match.NonEmptyString)(ExactUser.prototype, "name");

    expect(() =>
      check({ name: "Ada" }, Match.fromSchema(ExactUser)),
    ).not.toThrow();
    expectMatchFailure(() =>
      check({ name: "Ada", extra: true }, Match.fromSchema(ExactUser)),
    );

    expect(() =>
      check(
        { name: "Ada", extra: true },
        Match.fromSchema(ExactUser, { exact: false }),
      ),
    ).not.toThrow();

    expectMatchFailure(() =>
      check(
        { name: "Ada", extra: true },
        Match.fromSchema(ExactUser, { exact: true }),
      ),
    );

    const staticField = Match.Field(Match.Any);
    expect(() =>
      staticField(ExactUser as unknown as object, "staticValue"),
    ).not.toThrow();
  });

  it("supports Match.WithMessage inside decorator schemas", () => {
    const formatter = jest.fn(
      ({ value, path }: { value: unknown; path: string }) =>
        `retries is invalid. Received ${String(value)} at ${path}.`,
    );

    const positiveInteger = Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" && Number.isInteger(value) && value > 0,
    );

    class RetriesSchema {
      public retries!: number;
    }

    Match.Schema()(RetriesSchema);
    Match.Field(Match.WithMessage(positiveInteger, formatter))(
      RetriesSchema.prototype,
      "retries",
    );

    const retriesError = expectMatchFailure(() =>
      Match.fromSchema(RetriesSchema).parse({ retries: 0 }),
    );
    expect(retriesError.message).toBe(
      "retries is invalid. Received 0 at $.retries.",
    );
    expect(retriesError.data.path).toBe("$.retries");
    expect(retriesError.data.failures).toHaveLength(1);
    expect(retriesError.data.failures[0].message).toBe(
      "Failed Match.Where validation at $.retries.",
    );

    expect(formatter).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 0,
        path: "$.retries",
        pattern: positiveInteger,
      }),
    );
  });

  it("supports nested Match.WithMessage overrides in decorator schemas", () => {
    class ChildSchema {
      public name!: string;
    }

    class ParentSchema {
      public child!: ChildSchema;
    }

    Match.Schema()(ChildSchema);
    Match.Field(Match.WithMessage(String, "child name must be a string"))(
      ChildSchema.prototype,
      "name",
    );

    Match.Schema()(ParentSchema);
    Match.Field(
      Match.WithMessage(
        Match.fromSchema(ChildSchema),
        "child payload is invalid",
      ),
    )(ParentSchema.prototype, "child");

    const childError = expectMatchFailure(() =>
      check({ child: { name: 42 } }, Match.fromSchema(ParentSchema)),
    );
    expect(childError.message).toBe("child payload is invalid");
    expect(childError.data.path).toBe("$.child.name");
    expect(childError.data.failures[0].message).toBe(
      "Expected string, got number at $.child.name.",
    );
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
    expect(() =>
      check(
        {},
        Match.fromSchema(() => ({ nope: true }) as never),
      ),
    ).toThrow(RunnerError);

    const field = Match.Field(Match.Any);
    expect(() => field({}, Symbol("x"))).toThrow(RunnerError);
    expect(() => field(Object.create(null) as never, "x")).toThrow(RunnerError);
    expect(() => Match.WithMessage(Match.Any, null as never)).toThrow(
      RunnerError,
    );
    expect(() => Match.WithMessage(Match.Any, 42 as never)).toThrow(
      RunnerError,
    );
    expect(() =>
      Match.WithMessage(Match.Any, { message: 42 as never }),
    ).toThrow(RunnerError);
    expect(() =>
      Match.WithMessage(Match.Any, {
        message: "invalid",
        code: 42 as never,
      }),
    ).toThrow(RunnerError);
    expect(() =>
      Match.WithMessage(Match.Any, {
        message: "invalid",
        params: 42 as never,
      }),
    ).toThrow(RunnerError);

    expectInvalidPatternFailure(() =>
      Match.WithMessage(String, () => {
        throw new Error("boom");
      }).parse(1),
    );

    expectInvalidPatternFailure(() =>
      Match.WithMessage(String, () => 42 as never).parse(1),
    );
    expectInvalidPatternFailure(() =>
      Match.WithMessage(String, () => ({ message: 42 as never })).parse(1),
    );
    expectInvalidPatternFailure(() =>
      Match.WithMessage(String, () => ({
        message: "invalid",
        code: 42 as never,
      })).parse(1),
    );
    expectInvalidPatternFailure(() =>
      Match.WithMessage(String, () => ({
        message: "invalid",
        params: 42 as never,
      })).parse(1),
    );
  });

  it("supports Match.WithMessage in plain check()", () => {
    const emailError = expectMatchFailure(() =>
      check(
        { email: "nope" },
        {
          email: Match.WithMessage(
            Match.Email,
            ({ value, path }) => `invalid email ${String(value)} at ${path}`,
          ),
        },
      ),
    );
    expect(emailError.message).toBe("invalid email nope at $.email");
    expect(emailError.data.path).toBe("$.email");
    expect(emailError.data.failures[0].message).toBe(
      "Expected email, got string at $.email.",
    );
    expect(emailError.data.failures[0].code).toBeUndefined();

    expect(() =>
      check(
        "abc",
        Match.WithMessage(
          Match.Where((value: unknown) => value === "ABC"),
          "value must equal ABC",
        ),
      ),
    ).toThrow("value must equal ABC");

    const localizedError = expectMatchFailure(() =>
      check(
        { email: "still-nope" },
        {
          email: Match.WithMessage(Match.Email, ({ path }) => ({
            message: `Email is invalid at ${path}.`,
            code: "validation.email.invalid",
            params: { path },
          })),
        },
      ),
    );

    expect(localizedError.message).toBe("Email is invalid at $.email.");
    expect(localizedError.data.failures[0]).toMatchObject({
      path: "$.email",
      message: "Expected email, got string at $.email.",
      code: "validation.email.invalid",
      params: { path: "$.email" },
    });

    const directLocalizedError = expectMatchFailure(() =>
      check(
        { email: "nope-again" },
        {
          email: Match.WithMessage(Match.Email, {
            message: "Email is invalid.",
            code: "validation.email.invalid",
            params: { field: "email" },
          }),
        },
      ),
    );

    expect(directLocalizedError.message).toBe("Email is invalid.");
    expect(directLocalizedError.data.failures[0]).toMatchObject({
      path: "$.email",
      message: "Expected email, got string at $.email.",
      code: "validation.email.invalid",
      params: { field: "email" },
    });
  });

  it("does not let later WithMessage siblings replace the first aggregated failure", () => {
    const siblingError = expectMatchFailure(() =>
      check(
        {
          first: 1,
          second: 2,
        } as any,
        {
          first: String,
          second: Match.WithMessage(String, "second must be a string"),
        },
        { throwAllErrors: true },
      ),
    );
    expect(siblingError.message).toContain(
      "Match failed with 2 errors:\n- Expected string, got number at $.first.\n- Expected string, got number at $.second.",
    );
    expect(siblingError.data.failures).toHaveLength(2);
  });

  it("keeps the aggregate summary for sibling field WithMessage failures", () => {
    const aggregateError = expectMatchFailure(() =>
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
    expect(aggregateError.message).toContain(
      "Match failed with 2 errors:\n- Expected string, got number at $.first.\n- Expected string, got number at $.second.",
    );
    expect(aggregateError.data.failures).toHaveLength(2);
    expect(aggregateError.data.failures[0].path).toBe("$.first");
    expect(aggregateError.data.failures[1].path).toBe("$.second");
  });

  it("keeps subtree Match.WithMessage overrides as aggregate headlines", () => {
    class ChildSchema {
      public name!: string;
    }

    class ParentSchema {
      public child!: ChildSchema;
      public title!: string;
    }

    Match.Schema()(ChildSchema);
    Match.Field(String)(ChildSchema.prototype, "name");

    Match.Schema()(ParentSchema);
    Match.Field(
      Match.WithMessage(
        Match.fromSchema(ChildSchema),
        "child payload is invalid",
      ),
    )(ParentSchema.prototype, "child");
    Match.Field(String)(ParentSchema.prototype, "title");

    const parentError = expectMatchFailure(() =>
      check(
        {
          child: { name: 42 },
          title: 1,
        } as any,
        Match.fromSchema(ParentSchema),
        { throwAllErrors: true },
      ),
    );
    expect(parentError.message).toBe("child payload is invalid");
    expect(parentError.data.failures).toHaveLength(2);
    expect(parentError.data.failures[0].path).toBe("$.child.name");
    expect(parentError.data.failures[1].path).toBe("$.title");
  });

  it("reads errorPolicy defaults from Match.Schema metadata", () => {
    class AggregateChildSchema {
      public first!: string;
      public second!: string;
    }

    Match.Schema({ errorPolicy: "all" })(AggregateChildSchema);
    Match.Field(String)(AggregateChildSchema.prototype, "first");
    Match.Field(String)(AggregateChildSchema.prototype, "second");

    const aggregateChildError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(AggregateChildSchema),
      ),
    );
    expect(aggregateChildError.data.failures).toHaveLength(2);
    expect(aggregateChildError.data.failures[0].path).toBe("$.first");
    expect(aggregateChildError.data.failures[1].path).toBe("$.second");
  });

  it("keeps deprecated Match.Schema({ throwAllErrors }) support", () => {
    class LegacyAggregateSchema {
      public first!: string;
      public second!: string;
    }

    Match.Schema({ throwAllErrors: true })(LegacyAggregateSchema);
    Match.Field(String)(LegacyAggregateSchema.prototype, "first");
    Match.Field(String)(LegacyAggregateSchema.prototype, "second");

    const legacyAggregateError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(LegacyAggregateSchema),
      ),
    );
    expect(legacyAggregateError.data.failures).toHaveLength(2);
  });

  it("supports Match.fromSchema(..., { errorPolicy }) defaults", () => {
    class SchemaWithPerCallPolicy {
      public first!: string;
      public second!: string;
    }

    Match.Schema()(SchemaWithPerCallPolicy);
    Match.Field(String)(SchemaWithPerCallPolicy.prototype, "first");
    Match.Field(String)(SchemaWithPerCallPolicy.prototype, "second");

    const perCallError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(SchemaWithPerCallPolicy, { errorPolicy: "all" }),
      ),
    );
    expect(perCallError.data.failures).toHaveLength(2);
  });

  it("supports Match.fromSchema(..., { throwAllErrors: false }) alias defaults", () => {
    class SchemaWithLegacyPerCallPolicy {
      public first!: string;
      public second!: string;
    }

    Match.Schema({ throwAllErrors: true })(SchemaWithLegacyPerCallPolicy);
    Match.Field(String)(SchemaWithLegacyPerCallPolicy.prototype, "first");
    Match.Field(String)(SchemaWithLegacyPerCallPolicy.prototype, "second");

    const legacyPerCallError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(SchemaWithLegacyPerCallPolicy, {
          throwAllErrors: false,
        }),
      ),
    );
    expect(legacyPerCallError.data.failures).toHaveLength(1);
    expect(legacyPerCallError.data.path).toBe("$.first");
  });

  it("supports Match.fromSchema(..., { throwAllErrors: true }) alias defaults", () => {
    class SchemaWithLegacyAggregatePolicy {
      public first!: string;
      public second!: string;
    }

    Match.Schema()(SchemaWithLegacyAggregatePolicy);
    Match.Field(String)(SchemaWithLegacyAggregatePolicy.prototype, "first");
    Match.Field(String)(SchemaWithLegacyAggregatePolicy.prototype, "second");

    const legacyAggregatePolicyError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(SchemaWithLegacyAggregatePolicy, {
          throwAllErrors: true,
        }),
      ),
    );
    expect(legacyAggregatePolicyError.data.failures).toHaveLength(2);
  });

  it("maps deprecated Match.Schema({ throwAllErrors: false }) to fail-fast", () => {
    class LegacyFirstErrorSchema {
      public first!: string;
      public second!: string;
    }

    Match.Schema({ throwAllErrors: false })(LegacyFirstErrorSchema);
    Match.Field(String)(LegacyFirstErrorSchema.prototype, "first");
    Match.Field(String)(LegacyFirstErrorSchema.prototype, "second");

    const legacyFirstError = expectMatchFailure(() =>
      check(
        { first: 1, second: 2 } as any,
        Match.fromSchema(LegacyFirstErrorSchema),
      ),
    );
    expect(legacyFirstError.data.failures).toHaveLength(1);
    expect(legacyFirstError.data.path).toBe("$.first");
  });

  it("does not leak Match.WithMessage state across repeated parses", () => {
    const emailPattern = Match.WithMessage(
      Match.Email,
      ({ value, path }) => `invalid email ${String(value)} at ${path}`,
    );

    for (const candidate of ["nope", "still-nope"]) {
      const repeatedError = expectMatchFailure(() =>
        emailPattern.parse(candidate),
      );
      expect(repeatedError.message).toBe(`invalid email ${candidate} at $`);
      expect(repeatedError.data.path).toBe("$");
      expect(repeatedError.data.failures).toHaveLength(1);
    }
  });

  it("supports schema id metadata and class chain safety branches", () => {
    class Base {
      public id!: string;
    }

    class Derived extends Base {
      public title!: string;
    }

    Match.Schema({ schemaId: "custom.base" })(Base);
    Match.Schema({ exact: true })(Derived);
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

    Match.Schema()(Tracked);
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

  it("caches resolved schema definitions and invalidates on metadata updates", () => {
    class CachedSchema {
      public id!: string;
      public title!: string;
    }

    Match.Schema()(CachedSchema);
    Match.Field(Match.NonEmptyString)(CachedSchema.prototype, "id");

    const firstDefinition = getClassSchemaDefinition(CachedSchema);
    const secondDefinition = getClassSchemaDefinition(CachedSchema);
    expect(secondDefinition).toBe(firstDefinition);
    expect(Object.keys(firstDefinition.pattern)).toEqual(["id"]);

    Match.Field(Match.NonEmptyString)(CachedSchema.prototype, "title");

    const thirdDefinition = getClassSchemaDefinition(CachedSchema);
    expect(thirdDefinition).not.toBe(firstDefinition);
    expect(Object.keys(thirdDefinition.pattern)).toEqual(["id", "title"]);
  });

  it("supports explicit schema base extension via Match.Schema({ base })", () => {
    class BaseSchema {
      public id!: string;
    }

    class DerivedSchema {
      public title!: string;
    }

    class LazyDerivedSchema {
      public label!: string;
    }

    Match.Schema()(BaseSchema);
    Match.Field(Match.NonEmptyString)(BaseSchema.prototype, "id");

    Match.Schema({ base: BaseSchema })(DerivedSchema);
    Match.Field(Match.NonEmptyString)(DerivedSchema.prototype, "title");

    Match.Schema({ base: () => BaseSchema })(LazyDerivedSchema);
    Match.Field(Match.NonEmptyString)(LazyDerivedSchema.prototype, "label");

    expect(getClassSchemaDefinition(DerivedSchema).pattern).toEqual({
      id: Match.NonEmptyString,
      title: Match.NonEmptyString,
    });
    expect(getClassSchemaDefinition(LazyDerivedSchema).pattern).toEqual({
      id: Match.NonEmptyString,
      label: Match.NonEmptyString,
    });

    expect(() =>
      check(
        { id: "id-1", title: "Book" },
        Match.fromSchema(DerivedSchema, { exact: true }),
      ),
    ).not.toThrow();

    class LeftSchema {
      public left!: string;
    }

    class RightSchema {
      public right!: string;
    }

    Match.Schema({ base: () => RightSchema })(LeftSchema);
    Match.Schema({ base: () => LeftSchema })(RightSchema);
    Match.Field(Match.NonEmptyString)(LeftSchema.prototype, "left");
    Match.Field(Match.NonEmptyString)(RightSchema.prototype, "right");

    expect(() => getClassSchemaDefinition(LeftSchema)).toThrow(RunnerError);

    const AnonymousLeft = function () {
      return undefined;
    };
    const AnonymousRight = function () {
      return undefined;
    };
    Object.defineProperty(AnonymousLeft, "name", { value: "" });
    Object.defineProperty(AnonymousRight, "name", { value: "" });

    Match.Schema({ base: () => AnonymousRight as never })(
      AnonymousLeft as never,
    );
    Match.Schema({ base: () => AnonymousLeft as never })(
      AnonymousRight as never,
    );

    expect(() => getClassSchemaDefinition(AnonymousLeft as never)).toThrow(
      "Anonymous",
    );

    const AnonymousBaseOwner = function () {
      return undefined;
    };
    Object.defineProperty(AnonymousBaseOwner, "name", { value: "" });

    Match.Schema({ base: () => ({}) as never })(AnonymousBaseOwner as never);

    expect(() => getClassSchemaDefinition(AnonymousBaseOwner as never)).toThrow(
      RunnerError,
    );
  });
});
