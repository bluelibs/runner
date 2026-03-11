# Durable Workflows Example

Demonstrates two durable workflows using BlueLibs Runner's in-memory durable engine.

## Workflows

### 1. Order Processing (`processOrder`)

A multi-step order flow that waits for external payment confirmation:

1. **validateOrder** — checks the order input
2. **chargeCustomer** — simulates a payment charge
3. **sleep** — durable sleep (100 ms, survives restarts)
4. **waitForSignal** — suspends until `PaymentConfirmed` signal arrives
5. **shipOrder** — marks the order as shipped

### 2. User Onboarding (`userOnboarding`)

An onboarding flow with signal + timeout + replay-safe branching:

1. **createAccount** — provisions the user record
2. **sendVerificationEmail** — sends a verification email
3. **waitForSignal** — waits for `EmailVerified` signal (with 15 s timeout)
4. **durableContext.switch()** — branches: provision workspace if verified, skip if timed out
5. **sendWelcomeEmail** — sends a welcome message

## Running

```bash
cd examples/durable-workflows
npm install
npm start           # builds + runs index.ts (both workflows live)
npm test            # builds + runs the test suite
```

## What it shows

| Feature                                    | Where            |
| ------------------------------------------ | ---------------- |
| `durableContext.step(id, fn)`                         | Both workflows   |
| `durableContext.sleep(ms)`                            | Order processing |
| `durableContext.waitForSignal(signal)`                | Both workflows   |
| `durableContext.waitForSignal(signal, { timeoutMs })` | User onboarding  |
| `durableContext.switch()` (replay-safe branching)     | User onboarding  |
| `durableContext.note()`                               | Both workflows   |
| `service.start()`                          | index.ts         |
| `service.signal()`                         | index.ts         |
| `service.wait()`                           | index.ts         |
