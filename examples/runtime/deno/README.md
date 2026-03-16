# Deno Runtime Example

Runs the built universal Runner bundle under Deno and verifies execution-context
propagation across nested task calls.

## Command

```bash
npm run build
deno run -A examples/runtime/deno/main.mjs
```

The script throws immediately if Deno loses correlation id or abort-signal
inheritance.
