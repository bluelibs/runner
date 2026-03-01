import {
  Match,
  check,
  type InferMatchPattern,
  type MatchPattern,
} from "../../../";

// Type-only tests for check() pattern inference and overlap safety.

{
  const pattern: MatchPattern = String;
  void pattern;
}

{
  const value = check("name", String);
  value.toUpperCase();
  // @ts-expect-error String pattern must not infer number
  const invalid: number = value;
  void invalid;
}

{
  const mixed: string | number = Math.random() > 0.5 ? "x" : 1;
  const narrowed = check(mixed, String);
  narrowed.toUpperCase();
}

{
  const fromAny: any = "x";
  const narrowedAny = check(fromAny, String);
  narrowedAny.toUpperCase();
}

{
  const value = check(["a", "b"], [String]);
  const first: string = value[0];
  void first;
}

{
  const maybeValue = check("x", Match.Maybe(String));
  const maybeString: string | null | undefined = maybeValue;
  void maybeString;
}

{
  const unionValue = check(
    Math.random() > 0.5 ? "x" : 1,
    Match.OneOf(String, Number),
  );
  const typed: string | number = unionValue;
  void typed;
}

{
  const objectPattern = {
    id: String,
    retries: Match.Optional(Match.Integer),
  };
  type InferredObject = InferMatchPattern<typeof objectPattern>;

  const validObject: InferredObject = { id: "u1" };
  void validObject;
  // @ts-expect-error id should be string
  const invalidObject: InferredObject = { id: 1 };
  void invalidObject;

  const checked = check({ id: "u1", retries: 2 }, objectPattern);
  checked.id.toUpperCase();
  if (checked.retries !== undefined) {
    const retriesNumber: number = checked.retries;
    void retriesNumber;
  }
  // @ts-expect-error strict plain-object inference should not expose unknown keys
  checked.extra;
}

{
  const checked = check(
    { id: "u1", extra: true },
    Match.ObjectIncluding({ id: String }),
  );
  checked.id.toUpperCase();
  const extra: unknown = checked.extra;
  void extra;
}

{
  const guarded = Match.Where(
    (value: unknown): value is Date => value instanceof Date,
  );
  const checkedDate = check(new Date(), guarded);
  checkedDate.getTime();

  const candidate: unknown = new Date();
  if (Match.test(candidate, guarded)) {
    candidate.getTime();
  }
}

{
  const booleanWhere = Match.Where(
    (value: unknown) => typeof value === "number" && value > 0,
  );
  const checkedUnknown = check(5, booleanWhere);
  const asUnknown: unknown = checkedUnknown;
  void asUnknown;
}

{
  const alwaysString = "x";
  check(alwaysString, String);
  // @ts-expect-error disjoint value/pattern should fail compile-time overlap check
  check(alwaysString, Number);
}
