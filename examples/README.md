# Examples

These examples are designed for working inside the `runner` repository.

## Dependency model

- `@bluelibs/runner` is installed from the local repository via `file:../..` (or the matching relative path for nested examples).
- `@bluelibs/runner-dev`, when an example needs it, is installed from npm as a normal dependency.
- Example `package-lock.json` files are intentionally not tracked. This keeps GitHub security scanning focused on the shipped package surface instead of every sample app's resolved dependency tree.

This setup gives us two nice properties:

- examples always exercise the current local `runner` source
- tooling such as `runner-dev` behaves like a real consumer dependency

## Working inside this repo

From the repository root:

```bash
npm install
npm run build
cd examples/<example-name>
npm install
```

## Using an example outside this repo

If you want to copy an example into a real project, replace the local `file:...` dependency with published packages:

```json
{
  "dependencies": {
    "@bluelibs/runner": "^6.2.0"
  },
  "devDependencies": {
    "@bluelibs/runner-dev": "^6.2.0"
  }
}
```

Then run:

```bash
npm install
```

If that example does not use `runner-dev`, you do not need to add it.
