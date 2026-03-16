# Runtime Examples

Tiny runtime smoke examples for the universal `@bluelibs/runner` entrypoint.

These examples focus on the contract we care about for Bun and Deno:

- the root runtime entrypoint works
- `run(..., { executionContext: true })` is allowed when async-local storage exists
- nested task calls inherit correlation id and abort signal through execution context

## Run From This Repository

Build the package first so the examples exercise the generated universal bundle:

```bash
npm run build
```

Then run either runtime example:

- Bun: `bun run examples/runtime/bun/main.mjs`
- Deno: `deno run -A examples/runtime/deno/main.mjs`

Each example throws immediately if execution-context propagation does not work.
