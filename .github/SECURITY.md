# Security Policy

We take the security of @bluelibs/runner seriously. This document explains how to report vulnerabilities and what we do to keep the project secure.

## Supported Versions

- 4.x (current): security fixes accepted
- Older versions: not actively supported — please upgrade

## Reporting a Vulnerability

- Email: theodor@bluelibs.com (or open a private advisory via GitHub Security Advisories)
- Please provide a minimal reproduction, version info, and impact assessment.
- We follow responsible disclosure: we acknowledge receipt within 3 business days, provide a remediation plan within 10 business days, and coordinate a disclosure timeline.

## Scope and Threat Model

This package is a framework/runtime library. Primary concerns include:

- Dependency Injection integrity (no circular runtime resolution, consistent override precedence)
- Event system safety (cycle detection to avoid deadlocks/DoS)
- Validation gates (task/resource/event input and output validation)
- Error boundaries and graceful shutdown (avoid undefined crash states)
- Middleware protections (timeouts, retries, caching correctness)
- Context isolation and tag-based scoping for global hooks

## Hardening and Testing

- Security-focused Jest tests live under `src/__tests__/security/*` and cover the guarantees above.
- CI runs `npm audit` for production dependencies and the security test suite.

### Adversarial Scenarios Exercised

- Cycle DoS: hooks that cross-emit events to create cycles are detected and blocked (`security.event-cycles.test.ts`).
- Global listener scoping: events with `globals.tags.excludeFromGlobalHooks` never reach `on: "*"` hooks (`security.global-hooks.test.ts`).
- Validation boundary: invalid inputs are rejected before task.run executes (`security.validation-guards.test.ts`).
- Post-init lockdown: attempts to add listeners/interceptors or mutate the store after boot are rejected (`security.lockdown-after-init.test.ts`).
- Source spoofing: forging `event.source` can only self-suppress the matching listener; it cannot silence others or globals (`security.hackish-circumvention.test.ts`).
- Definition mutation footgun: mutating event definitions (e.g., `.tags`) changes future emission behavior; treat definitions as immutable (`security.mutation-footgun.test.ts`).

### Guidance Against Unsafe Patterns

- Do not mutate definitions (events, tasks, resources, middleware) at runtime. Treat them as immutable. Use tags, overrides, and wiring at definition time.
- Do not call `task.run` directly from interceptors; always invoke the provided `next(input)` to preserve validation, middleware, and error routing.
- Do not add listeners or interceptors after startup; the system intentionally locks to prevent late-binding tampering.
- Keep validation pure and fast; avoid fragile regex patterns that can lead to ReDoS.
- Avoid logging untrusted JSON that your own code later parses and merges without care. Keep logs simple or sanitize thoroughly.

## Dependency Security

- We aim to keep runtime dependencies minimal and up to date.
- Use `npm audit --omit=dev` to scan production dependencies locally.

## Contact & Disclosure

If you believe you've found a vulnerability, please do not open a public issue. Use the channels above for private disclosure. We will credit reporters who wish to be acknowledged.
