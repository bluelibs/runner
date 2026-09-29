# Local Runtime Shell

## Scope And Maintenance

This is opt-in Unix socket access to an existing Runner runtime. The connector
never boots a second app. Follow the Node and root guides.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Layout

- `shell.resource.ts`: resource init/ready/cooldown/dispose wiring.
- `ShellServer.ts`: listener, per-server async execution scope, and live connections.
- `connectShell.ts`: terminal connector; `runShell.ts`: captured noninteractive command result.
- `types.ts` and `index.ts`: public options, streams, and exports.
- `protocol.ts` and `protocolLine.ts`: versioned, validated, bounded handshake.
- `session.ts`, `interactiveRepl.ts`, `commandSession.ts`: native REPL/session setup and command execution.
- `sessionScope.ts`: lifecycle admission and read-only async scope around evaluation/completion.
- `context.ts`, `discovery.ts`: live runtime binding and discovery commands.
- `socketPath.ts`, `staleSocket.ts`: private directory validation and owned stale socket reclamation.
- `history.ts`: opt-in persistent history; output/writer/terminal helpers keep connector plumbing separate.

## Contracts To Preserve

- Shell execution runs against the owning runtime and uses canonical runtime addressing.
- Each server owns its own `AsyncLocalStorage`; read-only policy must not leak across sessions or apps.
- Server read-only policy is a floor; connector requests may strengthen it.
  Application resources enforce writes by consulting `shell.isReadOnly()`; this is not a JavaScript sandbox.
- Commands are admitted only while runtime lifecycle is Running or Paused; re-check after handshake/setup.
- Use Node's evaluator, including native top-level await; disable speculative preview of live expressions.
- Rebind the runtime after `.clear` and retain async scope across evaluation and completion callbacks.
- Validate versioned greetings before sending source an older REPL could execute.
- Socket paths are absolute, supported only on Unix, and inside an owner-only existing directory.
- Never reclaim a live socket or unrelated file; keep ownership/inode checks and reclamation marker coordination.
- Ready opens the listener; cooldown/dispose close it and disconnect sessions. Closing is idempotent.
- History stays opt-in, local to the app host, with private-path and file safety checks.
- Connectors do not own the caller's input/output streams; restore terminal raw mode during teardown.

## Tests And Acceptance

Tests mirror this tree in `../__tests__/shell/`.
`readOnly.test.ts`, `sessionScope.test.ts`, `admission.test.ts`, `realm.test.ts`,
`protocol.test.ts`, `staleSocket.test.ts`, and `history.test.ts` capture boundary behavior.
`connectShell.test.ts`, `runShell.test.ts`, and `shell.integration.test.ts` cover client/server flow.
Unix-only suites use `describeUnix` from `helpers.ts`; preserve those platform gates.
For code changes verify parallel sessions, app isolation, native evaluation, and teardown, then run root QA.
