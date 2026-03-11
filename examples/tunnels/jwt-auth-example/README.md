# @runner-examples/jwt-auth

JWT-protected remote execution using Runner `rpcLanes`.

## Install

```bash
cd examples/tunnels/jwt-auth-example
npm install
```

## Run

```bash
npm run start
```

This example:

- Starts a server runtime that serves lane-assigned tasks over HTTP via `rpcLanesResource`.
- Uses a client runtime with matching lane JWT config to run a protected remote task.
- Starts a second client with an invalid lane JWT secret to demonstrate fail-closed authorization.
- Keeps exposure auth (`exposure.http.auth`) and lane auth (`binding.auth`) as separate layers.
