# @runner-examples/jwt-auth

JWT auth over Runner tunnels as a self-contained example package.

## Install

```bash
cd examples/tunnels/jwt-auth-example
npm install
```

## Run

```bash
npm run start
```

This will:

- Start a Runner app that exposes tasks over HTTP via `nodeExposure`.
- Enforce JWT via a task middleware using `jsonwebtoken`.
- Execute a client task that calls the protected task with a signed token.
- Attempt an anonymous call to show the 401 JSON envelope.

Notes:

- The example depends on the local Runner via a file-based package link:
  - package.json → devDependencies → "@bluelibs/runner": "file:../../.."
  - Build the root package first if needed: from repository root run `npm run build`.
- Modify secrets or scopes in `examples/tunnels/jwt-auth.example.ts` as needed.
