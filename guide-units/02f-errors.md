## Errors

Typed Runner errors are declared once and can be used in two ways:

- recommended app/runtime usage: register them and inject them through dependencies
- local/helper usage: call `.new()`, `.throw()`, or `.is()` directly on the built helper even outside `run(...)`

Registering an error makes it part of the Runner definition graph, so it can be injected, discovered, and referenced declaratively via `.throws(...)`. The helper itself does not require a running container for local construction or `.is()` checks.

The injected value is the error helper itself, exposing:

- `.new()`
- `.throw()`
- `.is()`
- `id`
- optional `httpCode`

```typescript
import { r } from "@bluelibs/runner";

const userNotFoundError = r
  .error<{ code: number; message: string }>("userNotFound")
  .httpCode(404)
  .format((d) => `[${d.code}] ${d.message}`)
  .remediation("Verify the user ID exists before calling getUser.")
  .build();

const getUser = r
  .task("getUser")
  .dependencies({ userNotFoundError })
  .run(async (input, { userNotFoundError }) => {
    userNotFoundError.throw({ code: 404, message: `User ${input} not found` });
  })
  .build();
```

**What you just learned**: Runner errors are declared once as typed helpers, injected via dependencies, and consumed with `.throw()`, `.is()`, or `.new()`. They carry structured data, optional HTTP codes, and remediation advice.

The thrown error uses the helper id as its `name`.
By default `message` is `JSON.stringify(data)`, but `.format(...)` lets you produce a human-friendly message.
When `.remediation()` is provided, the advice is appended to `message` and `toString()`, and is also exposed as `error.remediation`.

### Error Helper APIs

```typescript
try {
  userNotFoundError.throw({ code: 404, message: "User not found" });
} catch (err) {
  if (userNotFoundError.is(err, { code: 404 })) {
    console.log(`Caught error: ${err.name} - ${err.message}`);
  }
}

const error = userNotFoundError.new({
  code: 404,
  message: "User not found",
});

throw error;
```

Notes:

- `errorHelper.is(err, partialData?)` is lineage-aware and works on errors created locally with the same helper, even outside `run(...)`
- `partialData` uses shallow strict matching
- `errorHelper.new(data)` returns the typed `RunnerError` without throwing
- `.new()` / `.throw()` / `.is()` do not require the helper to be registered
- registration is required when you want DI, store visibility, tag/discovery participation, or `.throws(...)` contracts to refer to that definition inside the app graph

### Dynamic Remediation

Remediation can also be a function when advice depends on error data.

```typescript
const quotaExceeded = r
  .error<{ limit: number; message: string }>("quotaExceeded")
  .format((d) => d.message)
  .remediation(
    (d) => `Current limit is ${d.limit}. Upgrade your plan or reduce usage.`,
  )
  .build();
```

### Detecting Any Runner Error

Use `r.error.is(error, partialData?)` when you want to check whether something is any Runner error, not just one specific helper instance.

```typescript
import { r } from "@bluelibs/runner";

// Assuming: riskyOperation is your own application function.
try {
  await riskyOperation();
} catch (err) {
  if (r.error.is(err, { code: 404 })) {
    console.error(`Runner error: ${err.id} (${err.httpCode || "N/A"})`);
  } else {
    console.error("Unexpected error:", err);
  }
}
```

### Declaring Error Contracts with `.throws()`

Use `.throws()` to declare the error ids a definition may produce.
This is declarative metadata for documentation and tooling, not runtime enforcement.

`.throws()` is available on task, resource, hook, and middleware builders.

```typescript
import { r } from "@bluelibs/runner";

const unauthorized = r.error<{ reason: string }>("unauthorized").build();

const userNotFound = r.error<{ userId: string }>("userNotFound").build();

const getUser = r
  .task("getUser")
  .throws([unauthorized, userNotFound, "unauthorized"])
  .run(async () => ({ ok: true }))
  .build();

console.log(getUser.throws);
```

The `throws` list is normalized and deduplicated at definition time.

Recommended practice:

- inject registered error helpers inside tasks/resources/hooks/middleware that are part of the Runner graph
- use standalone local helpers for isolated utility code, tests, or pre-runtime construction when DI is not needed
- do not assume `.throws(...)` alone makes an error injectable; injection still depends on registration

For dependency cycle detection, use the canonical helper name `circularDependencyError`.

> **runtime:** "Typed errors: because 'Error: something went wrong' is the stack trace equivalent of a shrug emoji. Give your errors a name, a code, and a remediation plan—future-you will mass an appreciation card at 2 AM."
