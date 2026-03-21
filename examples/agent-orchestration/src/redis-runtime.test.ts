import assert from "node:assert/strict";
import test from "node:test";

import { run } from "@bluelibs/runner";

import {
  buildRedisAgentApp,
  buildRedisStressAgentApp,
  createRedisDurableConfig,
} from "./app.js";
import { getRuntimeFromEnv } from "./index.js";
import {
  runParallelApprovalScenario,
  runParallelMixedReviewScenario,
} from "./index.js";
import { runRevisionThenApprovalScenario } from "./index.js";
import { runParallelStressScenario } from "./stress.js";

test("buildRedisAgentApp wires the production durable backend shape", () => {
  const shape = buildRedisAgentApp({
    namespace: "redis-shape",
    redisUrl: "redis://localhost:6379",
    rabbitUrl: "amqp://localhost",
  });

  assert.ok(shape.app);
  assert.ok(shape.durable);
  assert.ok(shape.workflow);
  assert.deepEqual(
    createRedisDurableConfig({
      namespace: "redis-shape",
      redisUrl: "redis://localhost:6379",
      rabbitUrl: "amqp://localhost",
    }),
    {
      namespace: "redis-shape",
      redis: { url: "redis://localhost:6379" },
      queue: { url: "amqp://localhost", quorum: true },
      worker: true,
      polling: { interval: 20 },
      audit: { enabled: true },
    },
  );
});

test("buildRedisStressAgentApp wires the stress workflow on the real backend shape", () => {
  const shape = buildRedisStressAgentApp({
    namespace: "redis-stress-shape",
    redisUrl: "redis://localhost:6379",
    rabbitUrl: "amqp://localhost",
  });

  assert.ok(shape.app);
  assert.ok(shape.durable);
  assert.ok(shape.workflow);
});

test("getRuntimeFromEnv can select the redis runtime shape", () => {
  const previousDriver = process.env.AGENT_ORCH_DRIVER;
  const previousNamespace = process.env.AGENT_ORCH_NAMESPACE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousRabbitUrl = process.env.RABBITMQ_URL;

  try {
    process.env.AGENT_ORCH_DRIVER = "redis";
    process.env.AGENT_ORCH_NAMESPACE = "env-redis";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.RABBITMQ_URL = "amqp://localhost";

    const shape = getRuntimeFromEnv();
    assert.match(shape.durable.id, /env-redis-durable/);
  } finally {
    process.env.AGENT_ORCH_DRIVER = previousDriver;
    process.env.AGENT_ORCH_NAMESPACE = previousNamespace;
    process.env.REDIS_URL = previousRedisUrl;
    process.env.RABBITMQ_URL = previousRabbitUrl;
  }
});

test("getRuntimeFromEnv uses default redis connection urls when env vars are absent", () => {
  const previousDriver = process.env.AGENT_ORCH_DRIVER;
  const previousNamespace = process.env.AGENT_ORCH_NAMESPACE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousRabbitUrl = process.env.RABBITMQ_URL;

  try {
    process.env.AGENT_ORCH_DRIVER = "redis";
    delete process.env.REDIS_URL;
    delete process.env.RABBITMQ_URL;
    delete process.env.AGENT_ORCH_NAMESPACE;

    const shape = getRuntimeFromEnv();
    assert.match(shape.durable.id, /agent-orchestration-durable/);
  } finally {
    process.env.AGENT_ORCH_DRIVER = previousDriver;
    process.env.AGENT_ORCH_NAMESPACE = previousNamespace;
    process.env.REDIS_URL = previousRedisUrl;
    process.env.RABBITMQ_URL = previousRabbitUrl;
  }
});

const shouldRun = process.env.DURABLE_INTEGRATION === "1";

test(
  "runs the agent workflow with Redis + RabbitMQ",
  { skip: !shouldRun },
  async () => {
    const shape = buildRedisAgentApp({
      namespace: "agent-orch-real",
      redisUrl:
        process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost",
      timing: { reviewTimeoutMs: 250, revisionTimeoutMs: 250 },
    });
    const runtime = await run(shape.app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(shape.durable);

    try {
      const discovered = service.getWorkflows();
      assert.ok(
        discovered.some((task) => task.id === runtime.store.findIdByDefinition(shape.workflow)),
      );

      const described = await service.describe(shape.workflow, {
        topic: "redis workflow discovery",
      });
      assert.ok(described);
    } finally {
      await runtime.dispose();
    }

    const result = await runRevisionThenApprovalScenario({
      driver: "redis",
      redisUrl:
        process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost",
      reviewTimeoutMs: 250,
      revisionTimeoutMs: 250,
    });

    assert.equal(result.status, "published");
    assert.equal(result.draft.version, 2);
  },
);

test(
  "runs 10 mixed parallel workflows with Redis + RabbitMQ within 10s",
  { skip: !shouldRun, timeout: 10_000 },
  async () => {
    const startedAt = Date.now();
    const results = await runParallelMixedReviewScenario({
      count: 10,
      driver: "redis",
      redisUrl:
        process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost",
      reviewTimeoutMs: 250,
      revisionTimeoutMs: 250,
      waitTimeoutMs: 10_000,
    });

    assert.equal(results.length, 10);
    assert.ok(results.every((result) => result.status === "published"));
    assert.ok(Date.now() - startedAt < 10_000);
  },
);

test(
  "runs 100 parallel approvals with Redis + RabbitMQ within 10s",
  { skip: !shouldRun, timeout: 10_000 },
  async () => {
    const startedAt = Date.now();
    const results = await runParallelApprovalScenario({
      count: 100,
      driver: "redis",
      redisUrl:
        process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost",
      reviewTimeoutMs: 500,
      waitTimeoutMs: 10_000,
    });

    assert.equal(results.length, 100);
    assert.ok(results.every((result) => result.status === "published"));
    assert.ok(Date.now() - startedAt < 10_000);
  },
);

test(
  "runs 50 complex stress workflows with Redis + RabbitMQ within 10s",
  { skip: !shouldRun, timeout: 10_000 },
  async () => {
    const startedAt = Date.now();
    const results = await runParallelStressScenario({
      count: 50,
      driver: "redis",
      redisUrl:
        process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost",
      reviewTimeoutMs: 250,
      revisionTimeoutMs: 250,
      waitTimeoutMs: 10_000,
    });

    assert.equal(results.length, 50);
    assert.ok(results.some((result) => result.status === "published"));
    assert.ok(results.some((result) => result.status === "rejected"));
    assert.ok(results.some((result) => result.status === "aborted"));
    assert.ok(results.some((result) => result.status === "cancelled"));
    assert.ok(Date.now() - startedAt < 10_000);
  },
);
