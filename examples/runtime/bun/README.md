# Bun Runtime Example

Runs the built universal Runner bundle under Bun and verifies execution-context
propagation across nested task calls.

## Command

```bash
npm run build
bun run examples/runtime/bun/main.mjs
```

The script throws immediately if Bun loses correlation id or abort-signal
inheritance.
