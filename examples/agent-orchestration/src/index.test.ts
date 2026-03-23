import assert from "node:assert/strict";
import test from "node:test";

import { run } from "@bluelibs/runner";

import {
  buildMemoryAgentApp,
  createMemoryDurableConfig,
  createRedisDurableConfig,
} from "./app.js";
import {
  createScenarioRuntimeShape,
  getRuntimeFromEnv,
  runDemoFromEnv,
  runParallelApprovalScenario,
  runParallelMixedReviewScenario,
  runRevisionThenApprovalScenario,
  waitForSignalCheckpoint,
} from "./index.js";
import { RevisedDraft, ReviewDecision } from "./signals.js";
import type { AgentResearchResult } from "./workflow.js";

test("publishes after one revision round", async () => {
  const result = await runRevisionThenApprovalScenario();

  assert.equal(result.status, "published");
  assert.equal(result.draft.version, 2);
  assert.equal(result.publishedBy, "editor@company.com");
  assert.match(result.draft.summary, /recovery, audit, replay, and queue-failure/i);
});

test("completes 10 parallel approvals with wait()", async () => {
  const startedAt = Date.now();
  const results = await runParallelApprovalScenario({
    count: 10,
    reviewTimeoutMs: 250,
    waitTimeoutMs: 10_000,
  });

  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.status === "published"));
  assert.ok(Date.now() - startedAt < 10_000);
});

test("completes parallel approvals with default timing options", async () => {
  const results = await runParallelApprovalScenario({
    count: 4,
  });

  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.status === "published"));
});

test("completes a mixed parallel review queue", async () => {
  const results = await runParallelMixedReviewScenario({
    count: 10,
    reviewTimeoutMs: 250,
    revisionTimeoutMs: 250,
    waitTimeoutMs: 10_000,
  });

  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.status === "published"));
  const revised = results.filter((result) => result.draft.version === 2);
  assert.ok(revised.length >= 3);
});

test("completes a mixed parallel review queue with default timing options", async () => {
  const results = await runParallelMixedReviewScenario({
    count: 6,
  });

  assert.equal(results.length, 6);
  assert.ok(results.every((result) => result.status === "published"));
});

test("getRuntimeFromEnv defaults to memory mode", () => {
  const previousDriver = process.env.AGENT_ORCH_DRIVER;
  const previousNamespace = process.env.AGENT_ORCH_NAMESPACE;

  try {
    delete process.env.AGENT_ORCH_DRIVER;
    process.env.AGENT_ORCH_NAMESPACE = "env-memory";

    const shape = getRuntimeFromEnv();
    assert.match(shape.durable.id, /env-memory-durable/);
  } finally {
    process.env.AGENT_ORCH_DRIVER = previousDriver;
    process.env.AGENT_ORCH_NAMESPACE = previousNamespace;
  }
});

test("getRuntimeFromEnv uses the default memory namespace when none is provided", () => {
  const previousDriver = process.env.AGENT_ORCH_DRIVER;
  const previousNamespace = process.env.AGENT_ORCH_NAMESPACE;

  try {
    delete process.env.AGENT_ORCH_DRIVER;
    delete process.env.AGENT_ORCH_NAMESPACE;

    const shape = getRuntimeFromEnv();
    assert.match(shape.durable.id, /agent-orchestration-durable/);
  } finally {
    process.env.AGENT_ORCH_DRIVER = previousDriver;
    process.env.AGENT_ORCH_NAMESPACE = previousNamespace;
  }
});

test("runDemoFromEnv executes the memory-backed happy path", async () => {
  const previousDriver = process.env.AGENT_ORCH_DRIVER;
  const previousNamespace = process.env.AGENT_ORCH_NAMESPACE;

  try {
    process.env.AGENT_ORCH_DRIVER = "memory";
    process.env.AGENT_ORCH_NAMESPACE = "env-demo";

    const result = await runDemoFromEnv();
    assert.equal(result.status, "published");
    assert.equal(result.draft.version, 2);
  } finally {
    process.env.AGENT_ORCH_DRIVER = previousDriver;
    process.env.AGENT_ORCH_NAMESPACE = previousNamespace;
  }
});

test("createScenarioRuntimeShape can prepare the redis-backed scenario", () => {
  const shape = createScenarioRuntimeShape({
    driver: "redis",
    redisUrl: "redis://localhost:6379",
    rabbitUrl: "amqp://localhost",
  });

  assert.match(shape.durable.id, /agent-orch-demo-durable/);
});

test("createScenarioRuntimeShape uses default redis and rabbit urls", () => {
  const shape = createScenarioRuntimeShape({ driver: "redis" });
  assert.match(shape.durable.id, /agent-orch-demo-durable/);
});

test("createScenarioRuntimeShape keeps the memory path when explicit timings are provided", () => {
  const shape = createScenarioRuntimeShape({
    reviewTimeoutMs: 10,
    revisionTimeoutMs: 15,
  });

  assert.match(shape.durable.id, /agent-orch-demo-durable/);
});

test("durable config builders expose the real backend contract explicitly", () => {
  assert.deepEqual(createMemoryDurableConfig(), {
    queue: { enabled: true },
    worker: true,
    polling: { interval: 20 },
    audit: { enabled: true },
  });

  assert.deepEqual(
    createRedisDurableConfig({
      namespace: "durable-contract",
      redisUrl: "redis://localhost:6379",
      rabbitUrl: "amqp://localhost",
    }),
    {
      namespace: "durable-contract",
      redis: { url: "redis://localhost:6379" },
      queue: { url: "amqp://localhost", quorum: true },
      worker: true,
      polling: { interval: 20 },
      audit: { enabled: true },
    },
  );
});

test("waitForSignalCheckpoint polls until the requested signal wait appears", async () => {
  let calls = 0;

  await waitForSignalCheckpoint({
    executionId: "exec-1",
    signalId: ReviewDecision.id,
    repository: {
      async findOneOrFail() {
        calls += 1;

        if (calls === 1) {
          return { steps: [{ result: null }] };
        }

        if (calls === 2) {
          return { steps: [{ result: { state: "waiting", signalId: "other" } }] };
        }

        return {
          steps: [{ result: { state: "waiting", signalId: ReviewDecision.id } }],
        };
      },
    },
  });

  assert.equal(calls, 3);
});

test("times out while waiting for the first review", async () => {
  const shape = buildMemoryAgentApp("review-timeout", {
    reviewTimeoutMs: 25,
    revisionTimeoutMs: 25,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "review timeout",
    });

    const result = await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.deepEqual(result.status, "timed_out");
    assert.deepEqual(result.phase, "review");
    assert.deepEqual(result.round, 1);
  } finally {
    await runtime.dispose();
  }
});

test("times out while waiting for a revised draft", async () => {
  const shape = buildMemoryAgentApp("revision-timeout", {
    reviewTimeoutMs: 25,
    revisionTimeoutMs: 25,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "revision timeout",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });

    await service.signal(executionId, ReviewDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Needs more detail.",
    });

    const result = await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.deepEqual(result.status, "timed_out");
    assert.deepEqual(result.phase, "revision");
    assert.deepEqual(result.round, 1);
  } finally {
    await runtime.dispose();
  }
});

test("escalates after too many revisions", async () => {
  const shape = buildMemoryAgentApp("max-revisions", {
    reviewTimeoutMs: 25,
    revisionTimeoutMs: 25,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "max revisions",
    });

    for (let round = 1; round <= 2; round += 1) {
      await waitForSignalCheckpoint({
        repository,
        executionId,
        signalId: ReviewDecision.id,
      });

      await service.signal(executionId, ReviewDecision, {
        decision: "revise",
        reviewer: "editor@company.com",
        feedback: `round ${round}`,
      });

      await waitForSignalCheckpoint({
        repository,
        executionId,
        signalId: RevisedDraft.id,
      });

      await service.signal(executionId, RevisedDraft, {
        author: "research-agent",
        summary: `revision round ${round}`,
      });
    }

    const result = await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "needs_human_help");
    assert.equal(result.reason, "max_revision_rounds");
    assert.equal(result.draft.version, 3);
  } finally {
    await runtime.dispose();
  }
});

test("handles revise-without-feedback before publishing", async () => {
  const shape = buildMemoryAgentApp("no-feedback", {
    reviewTimeoutMs: 25,
    revisionTimeoutMs: 25,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "no feedback",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });

    await service.signal(executionId, ReviewDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: RevisedDraft.id,
    });

    await service.signal(executionId, RevisedDraft, {
      author: "research-agent",
      summary: "Revision without explicit reviewer feedback.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });

    await service.signal(executionId, ReviewDecision, {
      decision: "approve",
      reviewer: "editor@company.com",
    });

    const result = await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });

    assert.equal(result.status, "published");
    assert.equal(result.draft.version, 2);
  } finally {
    await runtime.dispose();
  }
});

test("fails the durable execution when the evidence tool step crashes", async () => {
  const shape = buildMemoryAgentApp("tool-failure", {
    reviewTimeoutMs: 25,
    revisionTimeoutMs: 25,
  });
  const runtime = await run(shape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(shape.durable);
  const repository = service.getRepository(shape.workflow);

  try {
    const executionId = await service.start(shape.workflow, {
      topic: "tool failure",
      failAt: "evidence",
    });

    await assert.rejects(
      () =>
        service.wait(executionId, {
          timeout: 10_000,
          waitPollIntervalMs: 20,
        }),
      /tool failure/,
    );

    const execution = await repository.findOneOrFail({ id: executionId });
    assert.equal(execution.execution?.status, "failed");
  } finally {
    await runtime.dispose();
  }
});
