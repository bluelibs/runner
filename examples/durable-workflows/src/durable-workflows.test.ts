import test from "node:test";
import assert from "node:assert/strict";

import { run } from "@bluelibs/runner";

import {
  buildOnboardingApp,
  buildOrderApp,
  EmailVerified,
  IntervalMs,
  Namespace,
  type OnboardingWorkflowResult,
  type OrderWorkflowResult,
  PaymentConfirmed,
  TimeoutMs,
  waitForSignalCheckpoint,
} from "./durable-workflows.test-support.js";

enum TestName {
  OrderCompletesAfterSignal = "order processing: completes after signal",
  OnboardingVerifiedCompletesWithWorkspace = "user onboarding: verified path completes with workspace",
  OnboardingTimeoutSkipsProvisioning = "user onboarding: timeout path skips provisioning",
}

test(TestName.OrderCompletesAfterSignal, async () => {
  const { app, durable, store, processOrder } = buildOrderApp(Namespace.Order);
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);
    const executionId = await service.startExecution(processOrder, {
      orderId: "ORD-TEST-1",
      customerId: "CUST-TEST-1",
      amount: 49.99,
    });
    assert.ok(executionId, "should return an executionId");

    await waitForSignalCheckpoint({
      store,
      executionId,
      signalId: PaymentConfirmed.id,
    });

    await service.signal(executionId, PaymentConfirmed, {
      transactionId: "txn_test_001",
    });

    const result = (await service.wait(executionId, {
      timeout: TimeoutMs.ExecutionWait,
      waitPollIntervalMs: IntervalMs.WaitPolling,
    })) as OrderWorkflowResult;

    assert.equal(result.orderId, "ORD-TEST-1");
    assert.equal(result.transactionId, "txn_test_001");
    assert.equal(result.status, "shipped");
    assert.ok(result.shippedAt > 0, "shippedAt should be a positive timestamp");
  } finally {
    await runtime.dispose();
  }
});

test(TestName.OnboardingVerifiedCompletesWithWorkspace, async () => {
  const { app, durable, store, userOnboarding } = buildOnboardingApp(
    Namespace.OnboardingVerified,
    TimeoutMs.OnboardingLong,
  );
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);
    const executionId = await service.startExecution(userOnboarding, {
      email: "test@example.com",
      plan: "pro" as const,
    });
    assert.ok(executionId, "should return an executionId");

    await waitForSignalCheckpoint({
      store,
      executionId,
      signalId: EmailVerified.id,
    });

    await service.signal(executionId, EmailVerified, {
      verifiedAt: Date.now(),
    });

    const result = (await service.wait(executionId, {
      timeout: TimeoutMs.ExecutionWait,
      waitPollIntervalMs: IntervalMs.WaitPolling,
    })) as OnboardingWorkflowResult;

    assert.equal(result.email, "test@example.com");
    assert.equal(result.plan, "pro");
    assert.equal(result.verified, true);
    assert.ok(result.workspace !== null, "workspace should be provisioned");
    assert.ok(result.workspace!.startsWith("workspace_"), "workspace prefix");
    assert.ok(
      result.completedAt > 0,
      "completedAt should be a positive timestamp",
    );
  } finally {
    await runtime.dispose();
  }
});

test(TestName.OnboardingTimeoutSkipsProvisioning, async () => {
  const { app, durable, userOnboarding } = buildOnboardingApp(
    Namespace.OnboardingTimeout,
    TimeoutMs.OnboardingShort,
  );
  const runtime = await run(app, { logs: { printThreshold: null } });

  try {
    const service = runtime.getResourceValue(durable);
    const executionId = await service.startExecution(userOnboarding, {
      email: "timeout@example.com",
      plan: "free" as const,
    });

    const result = (await service.wait(executionId, {
      timeout: TimeoutMs.ExecutionWait,
      waitPollIntervalMs: IntervalMs.WaitPolling,
    })) as OnboardingWorkflowResult;

    assert.equal(result.email, "timeout@example.com");
    assert.equal(result.plan, "free");
    assert.equal(result.verified, false);
    assert.equal(result.workspace, null, "workspace should be null on timeout");
    assert.ok(result.completedAt > 0);
  } finally {
    await runtime.dispose();
  }
});
