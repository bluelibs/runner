import {
  type CheckSchemaLike,
  Match,
  check,
  type InferCheckSchema,
  type InferMatchPattern,
  type MatchCompiledSchema,
  type MatchJsonSchema,
  type MatchPattern,
} from "../../../";

// Type-only tests for check() pattern inference and overlap safety.

{
  type DemoParsed = { ok: true };
  const schema: CheckSchemaLike<DemoParsed> = {
    parse: (_value: unknown) => ({ ok: true }),
    toJSONSchema: () => ({ type: "object" }),
  };
  type Inferred = InferCheckSchema<typeof schema>;
  const value: Inferred = { ok: true };
  void value;
}

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
  const anyValue = check({ a: 1 }, Match.Any);
  const typedAny: any = anyValue;
  void typedAny;
}

{
  const value = check(["a", "b"], [String]);
  const first: string = value[0];
  void first;
}

{
  const fn = check(() => "ok", Function);
  const result = fn("a", 1, true);
  const typedResult: any = result;
  void typedResult;
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

{
  const schema = {
    parse: (value: unknown): { id: string; count: number } => ({
      id: String(value),
      count: 1,
    }),
  };

  const parsed = check(42, schema);
  parsed.id.toUpperCase();
  const count: number = parsed.count;
  void count;
  // @ts-expect-error schema result should not narrow to boolean
  const invalid: boolean = parsed;
  void invalid;
}

{
  const patternSchema = Match.ObjectIncluding({
    id: Match.NonEmptyString,
    retries: Match.Optional(Match.Integer),
  });
  const parsed = patternSchema.parse({ id: "u1", retries: 2 });
  parsed.id.toUpperCase();
  if (parsed.retries !== undefined) {
    const retries: number = parsed.retries;
    void retries;
  }
}

{
  const parsedInteger = Match.Integer.parse(10);
  const n: number = parsedInteger;
  void n;

  const parsedPositiveInteger = Match.PositiveInteger.parse(10);
  const p: number = parsedPositiveInteger;
  void p;

  const integerJsonSchema = Match.Integer.toJSONSchema();
  const integerTypedSchema: MatchJsonSchema = integerJsonSchema;
  void integerTypedSchema;
}

{
  const email = check("dev@example.com", Match.Email);
  const s: string = email;
  void s;

  const uuid = check("123e4567-e89b-42d3-a456-426614174000", Match.UUID);
  const uuidString: string = uuid;
  void uuidString;

  const url = check("https://example.com", Match.URL);
  const urlString: string = url;
  void urlString;

  const iso = check("2026-01-01T10:20:30Z", Match.IsoDateString);
  const isoString: string = iso;
  void isoString;
}

{
  const values = check([1, 2], Match.NonEmptyArray(Number));
  const first: number = values[0];
  void first;

  const unknownValues = check(["a"], Match.NonEmptyArray());
  const unknownFirst: unknown = unknownValues[0];
  void unknownFirst;
}

{
  const values = check([1, 2], Match.ArrayOf(Number));
  const first: number = values[0];
  void first;
}

{
  const map = check(
    { a: { id: "lane.a" } },
    Match.RecordOf(
      Match.ObjectIncluding({
        id: String,
      }),
    ),
  );
  const laneId: string = map.a.id;
  void laneId;
}

{
  const jsonSchema = Match.toJSONSchema({
    id: Match.NonEmptyString,
    retries: Match.Optional(Match.Integer),
  });

  const typedSchema: MatchJsonSchema = jsonSchema;
  void typedSchema;

  const idSchema = jsonSchema.properties?.id;
  if (idSchema?.type === "string") {
    const minLength = idSchema.minLength;
    void minLength;
  }
}

{
  const compiled = Match.compile({
    id: Match.NonEmptyString,
    retries: Match.Optional(Match.Integer),
  });

  const typedCompiled: MatchCompiledSchema<typeof compiled.pattern> = compiled;
  void typedCompiled;

  const parsed = compiled.parse({ id: "u1", retries: 1 });
  const id: string = parsed.id;
  void id;
  const retried = check({ id: "u1" }, compiled);
  retried.id.toUpperCase();
}
