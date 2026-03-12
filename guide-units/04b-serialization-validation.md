## Serialization

Serialization is where data crosses boundaries: HTTP, queues, storage, or process hops.
Runner's serializer is designed to be **functional first**: plain schemas, plain functions, explicit contracts.

Class decorators are optional. They are excellent DX when you want DTO ergonomics, but they are not required.

### Functional First

Use `Serializer` directly with explicit schema contracts:

```typescript
import { Match, Serializer } from "@bluelibs/runner";

const serializer = new Serializer();

const payloadSchema = Match.ArrayOf(
  Match.ObjectStrict({
    id: Match.NonEmptyString,
    age: Match.Integer,
  }),
);

const payload = serializer.serialize([
  { id: "u1", age: 42 },
  { id: "u2", age: 31 },
]);

const users = serializer.deserialize(payload, { schema: payloadSchema });
// users is validated on deserialize
```

### What It Handles

| Type          | JSON                         | Runner Serializer                                                                              |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `Date`        | String                       | Date object                                                                                    |
| `RegExp`      | Lost                         | RegExp object                                                                                  |
| `Map`, `Set`  | Lost                         | Preserved                                                                                      |
| `Uint8Array`  | Lost                         | Preserved                                                                                      |
| `bigint`      | Lost/unsafe numeric coercion | Preserved as `__type: "BigInt"` (decimal string payload)                                       |
| `symbol`      | Lost                         | Supports `Symbol.for(key)` and well-known symbols (unique `Symbol("...")` values are rejected) |
| Circular refs | Error                        | Preserved                                                                                      |
| Self refs     | Error                        | Preserved                                                                                      |

Two operational modes:

- Tree mode: `stringify()` / `parse()` (JSON-like API, type-aware)
- Graph mode: `serialize()` / `deserialize()` (handles circular/self references)

`parse()` ergonomics:

- `serializer.parse(payload)` is an alias of `serializer.deserialize(payload)`.
- `serializer.parse(payload, { schema })` is an ergonomic shorthand for "deserialize + validate/parse with schema".

```typescript
import { Match, Serializer } from "@bluelibs/runner";

const serializer = new Serializer();
const payload = serializer.serialize({ id: "u1", age: 42 });

// Explicit form
const viaDeserialize = serializer.deserialize(payload, {
  schema: Match.ObjectStrict({
    id: Match.NonEmptyString,
    age: Match.Integer,
  }),
});

// Ergonomic alias: same behavior
const viaParse = serializer.parse(payload, {
  schema: Match.ObjectStrict({
    id: Match.NonEmptyString,
    age: Match.Integer,
  }),
});
```

### Safety for Untrusted Payloads

When deserializing untrusted data, tighten defaults:

```typescript
import { Serializer } from "@bluelibs/runner";

const serializer = new Serializer({
  symbolPolicy: "well-known-only",
  allowedTypes: ["Date", "RegExp", "Map", "Set", "Uint8Array", "BigInt"],
  maxDepth: 64,
  maxRegExpPatternLength: 2000,
  allowUnsafeRegExp: false,
});
```

### Custom Types

```typescript
import { Serializer } from "@bluelibs/runner";

class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}
}

const serializer = new Serializer();

serializer.addType({
  id: "Money",
  is: (obj): obj is Money => obj instanceof Money,
  serialize: (money) => ({ amount: money.amount, currency: money.currency }),
  deserialize: (json) => new Money(json.amount, json.currency),
  strategy: "value",
});
```

### Class Ergonomics for Serialization (Great DX, Optional)

When DTO classes are your preferred style, combine `@Match.Schema()` with `@Serializer.Field(...)`.
This is purely ergonomic on top of the same runtime contracts.

```typescript
import { Match, Serializer } from "@bluelibs/runner";

@Match.Schema()
class UserDto {
  @Serializer.Field({ from: "abc" })
  @Match.Field(Match.NonEmptyString)
  id!: string;

  @Serializer.Field({
    from: "raw_age",
    deserialize: (value) => Number(value),
    serialize: (value) => String(value),
  })
  @Match.Field(Match.Integer)
  age!: number;
}

const serializer = new Serializer();
const user = serializer.deserialize('{"abc":"u1","raw_age":"42"}', {
  schema: UserDto,
});
```

Notes:

- Decorated class shorthand works for `schema: UserDto` and `schema: [UserDto]`.
- If a class is not decorated with `@Match.Schema()`, constructor shorthand uses constructor semantics (`instanceof`) and usually fails for plain deserialized objects.
- Functional schema style is always available: `schema: Match.fromSchema(UserDto)` and `schema: Match.ArrayOf(Match.fromSchema(UserDto))`.
- `@Serializer.Field(...)` itself does not require `@Match.Schema()` to register metadata.
  It affects class-instance serialization in all cases, but schema-aware deserialize class shorthand (`schema: UserDto`) still needs `@Match.Schema()` for validation to pass.

```typescript
import { Match, Serializer } from "@bluelibs/runner";

class OutboundUser {
  @Serializer.Field({ from: "user_id" })
  id!: string;
}

const serializer = new Serializer();
const outbound = new OutboundUser();
outbound.id = "u1";

// Works without @Match.Schema(): outgoing remap still applies
serializer.stringify(outbound); // {"user_id":"u1"}

class InboundUser {
  @Serializer.Field({ from: "user_id" })
  id!: string;
}

const payload = '{"user_id":"u1"}';

// This usually fails without @Match.Schema() because class shorthand falls back to constructor semantics
// serializer.deserialize(payload, { schema: InboundUser });

@Match.Schema()
class ValidatedInboundUser {
  @Serializer.Field({ from: "user_id" })
  @Match.Field(Match.NonEmptyString)
  id!: string;
}

serializer.deserialize(payload, { schema: ValidatedInboundUser }); // { id: "u1" }
```

> **Note:** File uploads are handled by Remote Lanes HTTP multipart support, not by the serializer.

---

## Runtime Validation

TypeScript protects compile-time contracts. Runtime validation protects trust boundaries.

Start with functional schemas and explicit parsers. Use classes when they improve developer ergonomics.

### Choosing a Style

| Situation                                   | Prefer Functional (`Match.*` / plain schemas) | Prefer Class (`@Match.Schema`, `@Match.Field`) |
| ------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Request/response boundaries                 | Best for explicit, local contracts            | Good when boundary DTOs are shared widely      |
| Dynamic shapes (maps, conditional payloads) | Best fit (`Match.MapOf`, composable patterns) | Usually more verbose                           |
| Large domain models reused across features  | Possible but can become repetitive            | Best readability and reuse                     |
| Wire-field remapping/transforms             | Works, but manual                             | Best DX with `@Serializer.Field(...)`          |
| Team preference                             | Functional programming style                  | OOP/DTO-centric style                          |

Rule of thumb:

- Start functional for most boundaries.
- Move to class-based schemas when the same contract appears in multiple places or when serializer field mapping becomes central.

### `check()` at a Glance

`check(value, patternOrSchema)` supports two modes:

```typescript
import { Match, check } from "@bluelibs/runner";

// Pattern mode: returns the same validated value, typed from pattern
const input = check(
  { userId: "u1", email: "ada@example.com" },
  {
    userId: Match.NonEmptyString,
    email: Match.Email,
  },
);

// Schema mode: calls schema.parse(input) and returns parsed/transformed output
const userInputSchema = Match.compile({
  id: Match.NonEmptyString,
  email: Match.Email,
  age: Match.Integer,
});

const parsed = check(
  { id: "u1", email: "ada@example.com", age: 42 },
  userInputSchema,
);
parsed.age; // number
```

### Shorthand Object Patterns (Real-World)

Plain object patterns are strict by default, recursively.

```typescript
import { Match, check } from "@bluelibs/runner";

const webhookPayload = check(
  {
    tenantId: "123e4567-e89b-42d3-a456-426614174000",
    event: "user.created",
    data: {
      user: {
        id: "u1",
        profile: { email: "ada@example.com" },
      },
    },
  },
  {
    tenantId: Match.UUID,
    event: String,
    data: {
      user: {
        id: Match.NonEmptyString,
        profile: { email: Match.Email },
      },
    },
  },
);
```

Equivalent strict semantics:

- `check(x, { a: { b: String } })` is treated like nested `Match.ObjectStrict({ ... })`.
- Unknown keys are rejected at each plain-object level.
- If you need extra keys, use `Match.ObjectIncluding({ ... })`.
- If keys are dynamic, use `Match.MapOf(valuePattern)`.
- Use `String`/`Number`/`Boolean` constructors for type checks.
- Literal patterns like `"string"` mean exact literal match, not type match.

Common object variants in practice:

```typescript
import { Match, check } from "@bluelibs/runner";

// 1) Strict object (default for plain object patterns)
check(
  { id: "u1", email: "ada@example.com" },
  { id: Match.NonEmptyString, email: Match.Email },
);

// 2) Include extra fields (for forward-compatible payloads)
check(
  { id: "u1", email: "ada@example.com", extra: { source: "web" } },
  Match.ObjectIncluding({
    id: Match.NonEmptyString,
    email: Match.Email,
  }),
);

// 3) Dynamic-key maps (for dictionaries / lookup tables)
check(
  {
    "tenant-a": { retries: 3 },
    "tenant-b": { retries: 5 },
  },
  Match.MapOf(
    Match.ObjectStrict({
      retries: Match.Integer,
    }),
  ),
);
```

### Extending Schemas

Extend plain object patterns by composition:

```typescript
import { Match } from "@bluelibs/runner";

const baseUser = {
  id: Match.NonEmptyString,
  email: Match.Email,
};

const adminUser = Match.compile({
  ...baseUser,
  role: Match.OneOf("admin", "owner"),
});
```

Compiled schemas do not expose `.extend()`. When the compiled schema was created from an object-shaped pattern, extend it by composing `compiled.pattern` into a new pattern and compiling again:

```typescript
import { Match } from "@bluelibs/runner";

const baseUser = Match.compile({
  id: Match.NonEmptyString,
  email: Match.Email,
});

const adminUser = Match.compile({
  ...baseUser.pattern,
  role: Match.OneOf("admin", "owner"),
});
```

For decorated class schemas, use `Match.Schema({ base })` to compose one schema class from another, with `base` accepting either a class or a lazy `() => Class` resolver.

### Match Reference

| Pattern / Helper                                             | What It Does                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `String`, `Number`, `Boolean`, `Function`, `Object`, `Array` | Constructor-based validation                                   |
| Class constructor (for example `Date`, `MyClass`)            | Validates via constructor semantics                            |
| Literal values (`"x"`, `42`, `true`, `null`, `undefined`)    | Exact literal match                                            |
| `[pattern]`                                                  | Array where every element matches `pattern`                    |
| Plain object (`{ a: String }`)                               | Strict object validation (same as `Match.ObjectStrict`)        |
| `Match.ObjectStrict({ ... })`                                | Strict object shape (`additionalProperties: false` semantics)  |
| `Match.ObjectIncluding({ ... })`                             | Partial object shape (unknown keys allowed)                    |
| `Match.MapOf(valuePattern)`                                  | Dynamic-key object with uniform value pattern                  |
| `Match.Any`                                                  | Accepts any value                                              |
| `Match.Integer`                                              | Signed 32-bit integer                                          |
| `Match.NonEmptyString`                                       | Non-empty string                                               |
| `Match.Email`                                                | Email-shaped string                                            |
| `Match.UUID`                                                 | Canonical UUID string                                          |
| `Match.URL`                                                  | Absolute URL string                                            |
| `Match.IsoDateString`                                        | ISO datetime string with timezone                              |
| `Match.RegExp(re)`                                           | String matching given regexp                                   |
| `Match.ArrayOf(pattern)`                                     | Array of elements matching pattern                             |
| `Match.NonEmptyArray()` / `Match.NonEmptyArray(pattern)`     | Non-empty array, optional element validation                   |
| `Match.Optional(pattern)`                                    | `undefined` or pattern                                         |
| `Match.Maybe(pattern)`                                       | `undefined`, `null`, or pattern                                |
| `Match.OneOf(...patterns)`                                   | Any one of given patterns                                      |
| `Match.Where((value, parent?) => boolean)`                   | Custom predicate / type guard                                  |
| `Match.WithMessage(pattern, messageOrFormatter)`            | Wraps a pattern with a custom top-level validation message     |
| `Match.Lazy(() => pattern)`                                  | Lazy/recursive pattern                                         |
| `Match.Schema(options?)`                                     | Class schema decorator (`exact`, `schemaId`, `errorPolicy`; see also `base`) |
| `Match.Schema({ base: BaseClass \| () => BaseClass })`       | Composes schema classes without requiring TypeScript `extends` |
| `Match.Field(pattern)`                                       | Decorated field validator                                      |
| `Match.fromSchema(Class, options?)`                          | Schema-like matcher from class metadata                        |
| `Match.WithErrorPolicy(pattern, "first" \| "all")`           | Sets a default validation aggregation policy on a pattern      |
| `Match.compile(pattern)`                                     | Compiles pattern into `{ parse, test, toJSONSchema }`          |
| `Match.test(value, pattern)`                                 | Boolean helper for validation check                            |
| `errors.matchError`                                          | Built-in Runner error helper for match failure                 |

### Additional `check()` Details

- `check(value, pattern, { errorPolicy: "all" })` aggregates all validation issues instead of fail-fast at first mismatch.
- `Match.WithErrorPolicy(pattern, "all")` stores the same aggregate behavior as the default for that Match-native pattern.
- `throwAllErrors` still works as a deprecated alias for `errorPolicy`.
- Recursive and forward patterns are supported via `Match.Lazy(...)`.
- Class-backed recursive graphs are supported with `Match.Schema()` + `Match.fromSchema(...)`.
  Use `Match.fromSchema(() => User)` inside decorated fields when a class needs to reference itself or a class declared later.
- In Runner builders (`inputSchema`, `payloadSchema`, `configSchema`, etc.), explicit `parse(input)` schemas have precedence; otherwise Runner falls back to pattern validation via `check(...)`.
- Decorator class shorthand in builder APIs (for example `.inputSchema(UserDto)` / `.configSchema(UserConfig)`) requires class metadata from `@Match.Schema()`.
- `Match.Schema({ exact, schemaId, errorPolicy })` controls class-level strictness, schema identity, and default validation aggregation; `Match.Schema({ base })` composes schema classes without TypeScript `extends`.
- `@Match.Schema({ errorPolicy: "all" })` gives `Match.fromSchema(MyClass)` the same aggregate-default behavior as `Match.WithErrorPolicy(...)`.
- `Match.WithMessage(pattern, messageOrFormatter)` overrides the thrown match-error message headline while preserving the normal error structure (`id`, `path`, `failures`).
- `messageOrFormatter` accepts a string, `{ message, code?, params? }`, or a callback `(ctx) => string | { message, code?, params? }`.
- When `code` / `params` are provided, Runner copies that metadata onto the owned `failures[]` entries without rewriting the raw leaf `message` text.
- Final match-error `failures` is always a flat array of leaf failures. Nested validation does not produce a tree of failures or a synthetic parent failure like `$.address` unless an actual matcher failed at that path.
- Match-error `path` always comes from the first recorded failure. If a nested field fails first, a parent custom headline may still be used, but `error.path` remains the nested leaf path such as `$.address.city`.
- With `check(value, pattern, { errorPolicy: "all" })`, the default headline is `"Match failed with N errors:\n- msg1\n- msg2"`.
- Leaf wrappers such as `Match.WithMessage(String, ...)` do not replace that aggregate headline; their underlying failures still appear in `error.failures`.
- Subtree wrappers such as plain objects, arrays, `Match.ObjectIncluding(...)`, `Match.MapOf(...)`, `Match.NonEmptyArray(...)`, `Match.Lazy(...)`, or `Match.fromSchema(...)` can replace the aggregate headline while still preserving the nested failures in `error.failures`.
- Decorator-backed schemas are not special here: `Match.WithMessage(Match.fromSchema(AddressSchema), ...)` behaves like any other subtree wrapper.
- In `Match.WithMessage(pattern, fn)`, the callback receives `ctx.error` built from the nested failures collected inside the wrapped pattern. That nested error exposes `path` and `failures`, but its `message` is rebuilt from the raw nested failures and does not preserve any inner `Match.WithMessage(...)` headline from deeper wrappers.
- `Match.Where((value, parent?) => boolean)` receives the immediate parent object/array when validation happens inside a compound value.

#### Recursive Patterns: Which Helper to Use

Use `Match.Lazy(...)` when the recursive thing is a plain Match pattern.

```typescript
import { Match, check } from "@bluelibs/runner";

const createTreePattern = () =>
  Match.ObjectIncluding({
    id: Match.NonEmptyString,
    children: Match.Optional(Match.ArrayOf(Match.Lazy(() => createTreePattern()))),
  });

check(
  {
    id: "root",
    children: [{ id: "child", children: [] }],
  },
  createTreePattern(),
);
```

Use `Match.fromSchema(() => User)` when the recursive thing is a decorated class schema.

```typescript
import { Match, check } from "@bluelibs/runner";

@Match.Schema()
class User {
  @Match.Field(Match.NonEmptyString)
  name!: string;

  @Match.Field(Match.fromSchema(() => User))
  self!: User;

  @Match.Field(Match.ArrayOf(Match.fromSchema(() => User)))
  children!: User[];
}

check(
  (() => {
    const user: Record<string, unknown> = {
      name: "Ada",
      children: [],
    };
    user.self = user;
    return user;
  })(),
  Match.fromSchema(User),
);
```

Rule of thumb:

- `Match.Lazy(...)` is the general recursion tool for plain objects, arrays, unions, and custom Match composition.
- `Match.fromSchema(() => Class)` is the class-schema version when you already use `@Match.Schema()` / `@Match.Field(...)`.

### Custom Match Messages

Use `Match.WithMessage(pattern, messageOrFormatter)` when a validation rule needs a more domain-specific message while keeping the normal error structure (`id`, `path`, `failures`).

```typescript
import { Match, check } from "@bluelibs/runner";

@Match.Schema()
class UserDto {
  @Match.Field(
    Match.WithMessage(
      String,
      ({ value, path, parent }) =>
        `Name must be a string. Received ${String(value)} at ${path} for user ${(parent as { id?: string })?.id ?? "unknown"}.`,
    ),
  )
  name!: string;
}

check({ name: 42 }, Match.fromSchema(UserDto));
```

The same wrapper works in plain `check(...)`:

```typescript
import { Match, check } from "@bluelibs/runner";

check("nope", Match.WithMessage(Match.Email, "Invalid email"));
```

Nested schema wrappers follow the same rules. The outer wrapper can replace the final headline, while the recorded failures still point to the nested leaf paths:

```typescript
import { Match, check } from "@bluelibs/runner";

@Match.Schema()
class AddressDto {
  @Match.Field(
    Match.WithMessage(String, "City must be a string"),
  )
  city!: string;
}

@Match.Schema()
class BillingDetailsDto {
  @Match.Field(
    Match.WithMessage(
      Match.fromSchema(AddressDto),
      ({ error }) => `Address is invalid. Nested validation failed: ${error.message}`,
    ),
  )
  address!: AddressDto;
}

try {
  check(
    { address: { city: 42 } },
    Match.fromSchema(BillingDetailsDto),
  );
} catch (error) {
  const matchError = error as {
    message: string;
    path: string;
    failures: Array<{ path: string; message: string }>;
  };
  // matchError.message ===
  // "Address is invalid. Nested validation failed: Expected string, got number at $.address.city."
  //
  // matchError.path === "$.address.city"
  //
  // matchError.failures === [
  //   {
  //     path: "$.address.city",
  //     message: "Expected string, got number at $.address.city.",
  //     ...
  //   }
  // ]
}
```

> **Note:** The outer formatter sees the raw nested failure summary, not the inner `"City must be a string"` headline. Inner `Match.WithMessage(...)` wrappers affect the thrown headline at their own level, but outer formatter callbacks receive a fresh nested match error rebuilt from raw failures.

Custom `Match.Where(...)` patterns work the same way and solve the standalone-message case:

```typescript
import { Match, check } from "@bluelibs/runner";

const AppMatch = {
  NonZeroPositiveInteger: Match.Where(
    (value: unknown): value is number =>
      typeof value === "number" && Number.isInteger(value) && value > 0,
  ),
} as const;

@Match.Schema()
class JobConfig {
  @Match.Field(
    Match.WithMessage(
      AppMatch.NonZeroPositiveInteger,
      ({ value, path }) =>
        `Retries must be a non-zero positive integer. Received ${String(value)} at ${path}.`,
    ),
  )
  retries!: number;
}

check({ retries: 0 }, Match.fromSchema(JobConfig));
```

Notes:

- `messageOrFormatter` accepts a static string, `{ message, code?, params? }`, or a callback.
- Callback context is `{ value, error, path, pattern, parent }`.
- `path` uses `$` for the root value, `$.email` for a root object field, and `$.users[2].email` for nested array/object paths.
- `value` is intentionally `unknown` because the callback runs only on the failure path.
- `parent` is only present when the value is being validated as part of an object, map, or array element.
- When `errorPolicy: "all"` collects multiple failures, the aggregate error message is `"Match failed with N errors:\n- msg1\n- msg2"` by default; leaf field `Match.WithMessage(...)` wrappers do not replace that summary, while subtree/schema wrappers still can.
- `Match.WithMessage(...)` is runtime-only and does not affect JSON Schema export beyond the wrapped inner pattern.
- `parent` is not attached to the thrown `errors.matchError`; it is runtime-only callback context.

### Second-Pass Validation with `errors.matchError`

Sometimes you want a first structural pass with `check(...)`, then a second domain-specific pass that raises a targeted validation error on an existing field path.

```typescript
import { errors, Match, check } from "@bluelibs/runner";

const input = check(
  { email: "ada@example.com" },
  {
    email: Match.Email,
  },
);

if (!isEmailUnique(input.email)) {
  throw errors.matchError.new({
    path: "$.email",
    failures: [
      {
        path: "$.email",
        expected: "unique email",
        actualType: "string",
        message: "Email already exists.",
      },
    ],
  });
}
```

This is useful when:

- the first pass validates structure and sync shape rules
- the second pass applies business rules that need custom wording
- you still want the result to look like a normal match-validation error

Notes:

- `errors.matchError.new(...)` is the preferred manual construction path.
- Array paths use bracket notation such as `$.users[2].email`.
- If your follow-up rule is asynchronous (for example, checking uniqueness in a database), perform that second pass in task/resource logic rather than inside `Match.Where(...)`.

### Extending Schemas

Schema extension works in both functional and class-based styles.

Functional extension (compose patterns):

```typescript
import { Match, check } from "@bluelibs/runner";

const baseUserPattern = {
  id: Match.NonEmptyString,
  email: Match.Email,
};

const adminUserPattern = {
  ...baseUserPattern,
  role: Match.OneOf("admin", "owner"),
  permissions: Match.NonEmptyArray(String),
};

// strict by default because plain object pattern => ObjectStrict semantics
const adminUser = check(
  {
    id: "u1",
    email: "admin@example.com",
    role: "admin",
    permissions: ["users.read", "users.write"],
  },
  adminUserPattern,
);
```

Class extension (compose schema metadata):

```typescript
import { Match, check } from "@bluelibs/runner";

@Match.Schema()
class BaseUserSchema {
  @Match.Field(Match.NonEmptyString)
  id!: string;
}

@Match.Schema({ base: BaseUserSchema })
class AdminUserSchema {
  @Match.Field(Match.OneOf("admin", "owner"))
  role!: string;
}

check({ id: "u1", role: "admin" }, Match.fromSchema(AdminUserSchema));
```

Notes:

- `Match.Schema({ base })` composes schemas even when classes do not use TypeScript `extends`.
- Lazy base is supported: `Match.Schema({ base: () => BaseUserSchema })` for forward references.
- You can tighten or relax class strictness at usage site with `Match.fromSchema(MyClass, { exact: true | false })`.

### Boundary Validation in Runner APIs

All builder schema entry points share the same parse contract: `{ parse(input): T }`.

```typescript
import { Match, r } from "@bluelibs/runner";

const createUser = r
  .task("app.tasks.createUser")
  .inputSchema(
    Match.ObjectStrict({
      name: Match.NonEmptyString,
      email: Match.Email,
    }),
  )
  .run(async (input) => ({ id: "user-1", ...input }))
  .build();

const database = r
  .resource("app.resources.database")
  .configSchema(
    Match.ObjectStrict({
      host: Match.NonEmptyString,
      port: Match.Integer,
    }),
  )
  .init(async (config) => config)
  .build();

const userCreated = r
  .event("app.events.userCreated")
  .payloadSchema(
    Match.ObjectStrict({
      userId: Match.NonEmptyString,
    }),
  )
  .build();

const timeout = r.middleware
  .task("app.middleware.timeout")
  .configSchema(
    Match.ObjectStrict({
      ttl: Match.Integer,
    }),
  )
  .run(async ({ next }) => next())
  .build();
```

Any schema library is valid if it implements `parse(input)`. Zod works directly and remains a great fit for richer refinement/transforms.

### Class Ergonomics for Validation (Great DX, Optional)

Class-backed contracts can be very readable in larger domains:

```typescript
import { Match, r } from "@bluelibs/runner";

@Match.Schema()
class CreateUserInput {
  @Match.Field(Match.NonEmptyString)
  name!: string;

  @Match.Field(Match.Email)
  email!: string;
}

const createUser = r
  .task("app.tasks.createUser")
  .inputSchema(CreateUserInput)
  .run(async (input) => ({ id: "user-1", ...input }))
  .build();
```

Keep the same rule: classes are optional ergonomics over runtime validation primitives.

### Combine Validation + Serialization on the Same Class

You can combine `@Match.Field(...)` and `@Serializer.Field(...)` to validate and transform wire payloads with one DTO contract.

```typescript
import { Match, Serializer } from "@bluelibs/runner";

@Match.Schema()
class PaymentDto {
  @Serializer.Field({ from: "order_id" })
  @Match.Field(Match.NonEmptyString)
  orderId!: string;

  @Serializer.Field({
    from: "amount_cents",
    deserialize: (value) => Number(value),
    serialize: (value: number) => String(value),
  })
  @Match.Field(Match.Integer)
  amountCents!: number;

  @Match.Field(Match.OneOf("USD", "EUR", "GBP"))
  currency!: string;
}

const serializer = new Serializer();

const payment = serializer.deserialize(
  '{"order_id":"ord-1","amount_cents":"2599","currency":"USD"}',
  { schema: PaymentDto },
);
```

Why this is powerful:

- Alias inbound/outbound wire keys (`order_id` <-> `orderId`).
- Transform values at field level (for example string cents <-> numeric cents).
- Keep runtime validation and serialization mapping in one place.

### JSON Schema Export

Use `Match.toJSONSchema(pattern, { strict? })` when you need machine-readable contracts for tooling or external systems.

- Output target is JSON Schema Draft 2020-12.
- Default (`strict: false`): runtime-only constructs export permissive annotated nodes (`x-runner-match-kind` metadata).
- Strict (`strict: true`): runtime-only patterns (currently `Match.Where` and `Function`) fail fast with `runner.errors.check.jsonSchemaUnsupportedPattern`.
- `Match.RegExp(re)` exports `type: "string"` + `pattern: re.source` (flags exported as metadata).
- `Match.fromSchema(...)` exports recursive class graphs using `$defs/$ref`.
- `Match.ObjectStrict(...)` exports strict object schemas (`additionalProperties: false`).
- `Match.MapOf(...)` exports dictionary schemas (`additionalProperties: <value schema>`).

Unsupported in strict mode (fail-fast):

- `Match.Where(...)`
- `Function` constructor pattern
- Custom class constructor patterns
- Literal `undefined`, `bigint`, `symbol`
- `Match.Optional(...)` / `Match.Maybe(...)` outside object-property context
