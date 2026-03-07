/**
 * Durable Workflows Example — Entry Point
 *
 * Runs two durable workflows end-to-end in a single process:
 *   1. Order Processing  — steps + sleep + signal
 *   2. User Onboarding   — steps + signal with timeout + switch branching
 *
 * Usage:
 *   npm run build && node dist/index.js
 */
import { r, run } from "@bluelibs/runner";

import {
  durable,
  durableRegistration,
  store,
  PaymentConfirmed,
  EmailVerified,
} from "./ids.js";
import { processOrder } from "./orderProcessing.js";
import { userOnboarding } from "./userOnboarding.js";
import type { OrderResult } from "./orderProcessing.js";
import type { OnboardingResult } from "./userOnboarding.js";
import { waitForSignalCheckpoint } from "./signalCheckpoint.js";

// ─── Root resource (wires everything) ────────────────────────────────────────

const app = r
  .resource("app")
  .register([
    durableRegistration,
    processOrder,
    userOnboarding,
    PaymentConfirmed,
    EmailVerified,
  ])
  .build();

// ─── Run both workflows ──────────────────────────────────────────────────────

export async function runDurableWorkflowsDemo(): Promise<{
  orderResult: OrderResult;
  onboardingResult: OnboardingResult;
}> {
  const runtime = await run(app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(durable);

  try {
    // ── Workflow 1: Order Processing ──────────────────────────────────────
    console.log("\n=== Workflow 1: Order Processing ===\n");

    const orderExecutionId = await service.start(processOrder, {
      orderId: "ORD-42",
      customerId: "CUST-7",
      amount: 99.99,
    });
    console.log(`  Started execution: ${orderExecutionId}`);

    // Wait until the workflow reaches the signal wait point (not just the sleep)
    await waitForSignalCheckpoint({
      store,
      executionId: orderExecutionId,
      signalId: PaymentConfirmed.id,
      timeoutMs: 5_000,
      intervalMs: 20,
    });
    console.log(
      "  Workflow is sleeping — waiting for PaymentConfirmed signal...",
    );

    // Simulate external payment confirmation (e.g. from a webhook)
    await service.signal(orderExecutionId, PaymentConfirmed, {
      transactionId: "txn_abc_123",
    });
    console.log("  Signal sent: PaymentConfirmed");

    // Wait for the execution to complete
    const orderResult = await service.wait<OrderResult>(orderExecutionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });
    console.log("  Order result:", orderResult);

    // ── Workflow 2: User Onboarding (verified path) ──────────────────────
    console.log("\n=== Workflow 2: User Onboarding ===\n");

    const onboardingExecutionId = await service.start(userOnboarding, {
      email: "ada@example.com",
      plan: "pro" as const,
    });
    console.log(`  Started execution: ${onboardingExecutionId}`);

    // Wait for the workflow to reach the signal wait point
    await waitForSignalCheckpoint({
      store,
      executionId: onboardingExecutionId,
      signalId: EmailVerified.id,
      timeoutMs: 5_000,
      intervalMs: 20,
    });
    console.log("  Workflow is sleeping — waiting for EmailVerified signal...");

    // Simulate user clicking the verification link
    await service.signal(onboardingExecutionId, EmailVerified, {
      verifiedAt: Date.now(),
    });
    console.log("  Signal sent: EmailVerified");

    // Wait for completion
    const onboardingResult = await service.wait<OnboardingResult>(
      onboardingExecutionId,
      {
      timeout: 10_000,
      waitPollIntervalMs: 20,
      },
    );
    console.log("  Onboarding result:", onboardingResult);

    console.log("\n=== All workflows completed successfully! ===\n");

    return { orderResult, onboardingResult };
  } finally {
    await runtime.dispose();
  }
}

// ─── Self-execute when run directly ──────────────────────────────────────────

runDurableWorkflowsDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
