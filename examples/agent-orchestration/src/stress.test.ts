import assert from "node:assert/strict";
import test from "node:test";

import { run } from "@bluelibs/runner";

import { buildMemoryStressAgentApp } from "./app.js";
import { waitForSignalCheckpoint } from "./index.js";
import {
  ComplianceDecision,
  StressPolicyDecision,
  StressRevisionDraft,
} from "./signals.js";
import {
  runParallelStressScenario,
  type StressScenarioOutcome,
} from "./stress.js";
import type { StressAgentResult } from "./workflow.js";

const SHORT_SIGNAL_TIMEOUT_MS = 100;
const INTERACTIVE_SIGNAL_TIMEOUT_MS = 1_000;

test("runs a mixed stress batch with published, rejected, aborted, and cancelled outcomes", async () => {
  const results = await runParallelStressScenario({
    count: 12,
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    waitTimeoutMs: 10_000,
  });

  const countByStatus = new Map<string, number>();
  for (const result of results) {
    countByStatus.set(result.status, (countByStatus.get(result.status) ?? 0) + 1);
  }

  assert.equal(results.length, 12);
  assert.ok((countByStatus.get("published") ?? 0) >= 6);
  assert.ok((countByStatus.get("rejected") ?? 0) >= 1);
  assert.ok((countByStatus.get("aborted") ?? 0) >= 1);
  assert.ok((countByStatus.get("cancelled") ?? 0) >= 1);

  const revised = results.find(
    (result): result is Extract<StressScenarioOutcome, { status: "published" }> =>
      result.status === "published" && result.revisionCount === 1,
  );
  assert.ok(revised);
  assert.equal(revised.draft.version, 2);
});

test("rolls back compensated steps when a reviewer aborts", async () => {
  const shape = buildMemoryStressAgentApp("stress-abort", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "abort me",
      lane: "fast",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "abort",
      reviewer: "editor@company.com",
      feedback: "Stop this draft.",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "aborted");
    assert.deepEqual(result.revertedSteps, [
      "draft-stress-v1",
      "reserve-budget",
    ]);
  } finally {
    await runtime.dispose();
  }
});

test("handles careful-lane revision and then approval", async () => {
  const shape = buildMemoryStressAgentApp("stress-revise", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "revise me",
      lane: "careful",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Add more receipts.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressRevisionDraft.id,
    });

    await service.signal(executionId, StressRevisionDraft, {
      summary: "Revised careful draft with better receipts.",
      citations: 8,
      author: "research-agent",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "approve",
      reviewer: "editor@company.com",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "published");
    assert.equal(result.revisionCount, 1);
    assert.equal(result.draft.version, 2);
  } finally {
    await runtime.dispose();
  }
});

test("rejects regulated drafts at compliance and rolls back", async () => {
  const shape = buildMemoryStressAgentApp("stress-reject", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "reject me",
      lane: "regulated",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "approve",
      reviewer: "editor@company.com",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ComplianceDecision.id,
    });

    await service.signal(executionId, ComplianceDecision, {
      decision: "reject",
      reviewer: "compliance@company.com",
      note: "Too spicy for legal.",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "rejected");
    assert.deepEqual(result.revertedSteps, [
      "draft-stress-v1",
      "reserve-budget",
    ]);
  } finally {
    await runtime.dispose();
  }
});

test("times out when the first stress policy signal never arrives", async () => {
  const shape = buildMemoryStressAgentApp("stress-policy-timeout", {
    reviewTimeoutMs: SHORT_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: SHORT_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "timeout me",
      lane: "fast",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "aborted");
    assert.equal(result.reason, "policy_timeout");
  } finally {
    await runtime.dispose();
  }
});

test("times out when a stress revision never arrives", async () => {
  const shape = buildMemoryStressAgentApp("stress-revision-timeout", {
    reviewTimeoutMs: SHORT_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: SHORT_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "timeout revision",
      lane: "careful",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Need a rewrite.",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "aborted");
    assert.equal(result.reason, "revision_timeout");
  } finally {
    await runtime.dispose();
  }
});

test("aborts when the revision budget is exhausted", async () => {
  const shape = buildMemoryStressAgentApp("stress-revision-budget", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "too many rewrites",
      lane: "careful",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Round one.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressRevisionDraft.id,
    });

    await service.signal(executionId, StressRevisionDraft, {
      summary: "Revised once.",
      citations: 4,
      author: "research-agent",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Round two.",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "aborted");
    assert.equal(result.reason, "revision_budget_exhausted");
  } finally {
    await runtime.dispose();
  }
});

test("rolls back reserved work when stress evidence collection fails", async () => {
  const shape = buildMemoryStressAgentApp("stress-evidence-failure", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "broken evidence",
      lane: "fast",
      failAt: "evidence",
    });

    await assert.rejects(
      () =>
        service.wait(executionId, {
          timeout: 10_000,
          waitPollIntervalMs: 20,
        }),
      /broken evidence/,
    );

    const execution = await repository.findOneOrFail({ id: executionId });
    assert.equal(execution.execution?.status, "failed");
  } finally {
    await runtime.dispose();
  }
});

test("rejects regulated drafts when compliance never answers", async () => {
  const shape = buildMemoryStressAgentApp("stress-compliance-timeout", {
    reviewTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
    revisionTimeoutMs: INTERACTIVE_SIGNAL_TIMEOUT_MS,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "silent compliance",
      lane: "regulated",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: StressPolicyDecision.id,
    });

    await service.signal(executionId, StressPolicyDecision, {
      decision: "approve",
      reviewer: "editor@company.com",
    });

    const result = await service.wait<StressAgentResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "rejected");
    assert.equal(result.rejectedBy, "compliance-timeout");
  } finally {
    await runtime.dispose();
  }
});
