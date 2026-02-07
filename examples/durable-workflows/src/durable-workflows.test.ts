/**
 * Tests for the durable workflows example.
 *
 * Uses Node's built-in test runner (node:test + node:assert).
 *
 * Verifies:
 *   1. Order processing workflow completes with expected fields.
 *   2. User onboarding workflow completes via the "verified" path.
 *   3. User onboarding workflow handles the "timeout" path (no signal sent).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  r,
  run,
  event,
  waitUntil,
  durableResource,
  MemoryStore,
  MemoryEventBus,
} from "@bluelibs/runner/node";

import type { OrderResult } from "./orderProcessing.js";
import type { OnboardingResult } from "./userOnboarding.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Signal definitions (local to tests to avoid cross-import type conflicts) */
const PaymentConfirmed = event<{ transactionId: string }>({
  id: "test.signals.paymentConfirmed",
});

const EmailVerified = event<{ verifiedAt: number }>({
  id: "test.signals.emailVerified",
});

/**
 * Creates a fully isolated durable resource + tasks + app for each test.
 * Each test gets its own MemoryStore so there's zero state leakage.
 */
function buildOrderApp(ns: string) {
  const store = new MemoryStore();
  const durable = durableResource.fork(`${ns}.durable`);
  const durableRegistration = durable.with({
    store,
    eventBus: new MemoryEventBus(),
    worker: true,
    polling: { interval: 10 },
  });

  const processOrder = r
    .task(`${ns}.tasks.processOrder`)
    .dependencies({ durable })
    .run(async (input: { orderId: string; customerId: string; amount: number }, { durable }) => {
      const ctx = durable.use();

      const validated = await ctx.step("validateOrder", async () => {
        if (!input.orderId || input.amount <= 0) throw new Error("Invalid order");
        return { orderId: input.orderId, customerId: input.customerId, amount: input.amount };
      });

      const charge = await ctx.step("chargeCustomer", async () => ({
        chargeId: `chg_${validated.orderId}`,
        charged: validated.amount,
      }));

      await ctx.sleep(50);

      const confirmation = await ctx.waitForSignal(PaymentConfirmed, {
        stepId: "awaitPaymentConfirmation",
      });

      const shipment = await ctx.step("shipOrder", async () => ({
        orderId: validated.orderId,
        transactionId: confirmation.transactionId,
        status: "shipped" as const,
        shippedAt: Date.now(),
      }));

      await ctx.note(`Order ${validated.orderId} shipped via charge ${charge.chargeId}`);
      return shipment;
    })
    .build();

  const app = r
    .resource(`${ns}.app`)
    .register([durableRegistration, processOrder, PaymentConfirmed])
    .build();

  return { app, durable, store, processOrder };
}

function buildOnboardingApp(ns: string, signalTimeoutMs: number) {
  const store = new MemoryStore();
  const durable = durableResource.fork(`${ns}.durable`);
  const durableRegistration = durable.with({
    store,
    eventBus: new MemoryEventBus(),
    worker: true,
    polling: { interval: 10 },
  });

  const userOnboarding = r
    .task(`${ns}.tasks.userOnboarding`)
    .dependencies({ durable })
    .run(async (input: { email: string; plan: "free" | "pro" }, { durable }) => {
      const ctx = durable.use();

      const account = await ctx.step("createAccount", async () => ({
        userId: `user_${Date.now()}`,
        email: input.email,
        plan: input.plan,
      }));

      await ctx.note(`Account created for ${account.email}`);

      await ctx.step("sendVerificationEmail", async () => ({
        sentTo: account.email,
        sentAt: Date.now(),
      }));

      const verification = await ctx.waitForSignal(EmailVerified, {
        stepId: "awaitEmailVerification",
        timeoutMs: signalTimeoutMs,
      });

      const workspace: string | null = await ctx.switch(
        "provisionBranch",
        verification,
        [
          {
            id: "verified",
            match: (v: typeof verification) => v.kind === "signal",
            run: async () => {
              return await ctx.step("provisionResources", async () => {
                return `workspace_${account.userId}`;
              });
            },
          },
          {
            id: "timed-out",
            match: (v: typeof verification) => v.kind === "timeout",
            run: async () => {
              await ctx.note("Email verification timed out");
              return null;
            },
          },
        ],
      );

      await ctx.step("sendWelcomeEmail", async () => ({
        sentTo: account.email,
        verified: verification.kind === "signal",
        sentAt: Date.now(),
      }));

      return {
        userId: account.userId,
        email: account.email,
        plan: account.plan,
        verified: verification.kind === "signal",
        workspace,
        completedAt: Date.now(),
      } satisfies OnboardingResult;
    })
    .build();

  const app = r
    .resource(`${ns}.app`)
    .register([durableRegistration, userOnboarding, EmailVerified])
    .build();

  return { app, durable, store, userOnboarding };
}

// ─── Test 1: Order Processing ────────────────────────────────────────────────

test("order processing: completes after signal", async () => {
  const { app, durable, store, processOrder } = buildOrderApp("t1");
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(processOrder, {
      orderId: "ORD-TEST-1",
      customerId: "CUST-TEST-1",
      amount: 49.99,
    });
    assert.ok(executionId, "should return an executionId");

    // Wait until the execution reaches the signal wait point
    await waitUntil(
      async () => {
        const steps = await store.listStepResults(executionId);
        return steps.some((s) => {
          const r = s.result as Record<string, unknown> | null;
          return r && r.state === "waiting";
        });
      },
      { timeoutMs: 5_000, intervalMs: 10 },
    );

    // Send the PaymentConfirmed signal
    await service.signal(executionId, PaymentConfirmed, {
      transactionId: "txn_test_001",
    });

    // Wait for completion
    const result = (await service.wait(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 10,
    })) as OrderResult;

    assert.equal(result.orderId, "ORD-TEST-1");
    assert.equal(result.transactionId, "txn_test_001");
    assert.equal(result.status, "shipped");
    assert.ok(result.shippedAt > 0, "shippedAt should be a positive timestamp");
  } finally {
    await runtime.dispose();
  }
});

// ─── Test 2: User Onboarding — verified path ────────────────────────────────

test("user onboarding: verified path completes with workspace", async () => {
  const { app, durable, store, userOnboarding } = buildOnboardingApp("t2", 15_000);
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(userOnboarding, {
      email: "test@example.com",
      plan: "pro" as const,
    });
    assert.ok(executionId, "should return an executionId");

    // Wait until the execution reaches the signal wait point
    await waitUntil(
      async () => {
        const steps = await store.listStepResults(executionId);
        return steps.some((s) => {
          const r = s.result as Record<string, unknown> | null;
          return r && r.state === "waiting";
        });
      },
      { timeoutMs: 5_000, intervalMs: 10 },
    );

    // Send the verification signal
    await service.signal(executionId, EmailVerified, { verifiedAt: Date.now() });

    const result = (await service.wait(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 10,
    })) as OnboardingResult;

    assert.equal(result.email, "test@example.com");
    assert.equal(result.plan, "pro");
    assert.equal(result.verified, true);
    assert.ok(result.workspace !== null, "workspace should be provisioned");
    assert.ok(result.workspace!.startsWith("workspace_"), "workspace prefix");
    assert.ok(result.completedAt > 0, "completedAt should be a positive timestamp");
  } finally {
    await runtime.dispose();
  }
});

// ─── Test 3: User Onboarding — timeout path ─────────────────────────────────

test("user onboarding: timeout path skips provisioning", async () => {
  // Very short signal timeout (200 ms) — will expire before any signal
  const { app, durable, userOnboarding } = buildOnboardingApp("t3", 200);
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(userOnboarding, {
      email: "timeout@example.com",
      plan: "free" as const,
    });

    // Do NOT send any signal — let it time out and complete on its own
    const result = (await service.wait(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 10,
    })) as OnboardingResult;

    assert.equal(result.email, "timeout@example.com");
    assert.equal(result.plan, "free");
    assert.equal(result.verified, false);
    assert.equal(result.workspace, null, "workspace should be null on timeout");
    assert.ok(result.completedAt > 0);
  } finally {
    await runtime.dispose();
  }
});
