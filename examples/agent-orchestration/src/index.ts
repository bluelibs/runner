import { run } from "@bluelibs/runner";
import { waitUntil } from "@bluelibs/runner/node";

import { buildMemoryAgentApp, buildRedisAgentApp } from "./app.js";
import { RevisedDraft, ReviewDecision } from "./signals.js";
import type { AgentResearchResult } from "./workflow.js";

type Driver = "memory" | "redis";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWaitingForSignal(
  value: unknown,
  signalId: string,
): value is { state: "waiting"; signalId: string } {
  return (
    isRecord(value) &&
    value.state === "waiting" &&
    value.signalId === signalId
  );
}

export async function waitForSignalCheckpoint(params: {
  repository: {
    findOneOrFail(query: {
      id: string;
    }): Promise<{ steps: Array<{ result: unknown }> }>;
  };
  executionId: string;
  signalId: string;
}): Promise<void> {
  await waitUntil(
    async () => {
      const detail = await params.repository.findOneOrFail({
        id: params.executionId,
      });
      return detail.steps.some((stepResult) =>
        isWaitingForSignal(stepResult.result, params.signalId),
      );
    },
    { timeoutMs: 10_000, intervalMs: 20 },
  );
}

export function getRuntimeFromEnv() {
  const driver = (process.env.AGENT_ORCH_DRIVER ?? "memory") as Driver;

  if (driver === "redis") {
    return buildRedisAgentApp({
      namespace: process.env.AGENT_ORCH_NAMESPACE ?? "agent-orchestration",
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
      rabbitUrl: process.env.RABBITMQ_URL ?? "amqp://localhost",
    });
  }

  return buildMemoryAgentApp(
    process.env.AGENT_ORCH_NAMESPACE ?? "agent-orchestration",
  );
}

export function createScenarioRuntimeShape(params?: {
  driver?: Driver;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
}) {
  return params?.driver === "redis"
    ? buildRedisAgentApp({
        namespace: "agent-orch-demo",
        redisUrl: params.redisUrl ?? "redis://localhost:6379",
        rabbitUrl: params.rabbitUrl ?? "amqp://localhost",
        timing: {
          reviewTimeoutMs: params.reviewTimeoutMs,
          revisionTimeoutMs: params.revisionTimeoutMs,
        },
      })
    : buildMemoryAgentApp("agent-orch-demo", {
        reviewTimeoutMs: params?.reviewTimeoutMs,
        revisionTimeoutMs: params?.revisionTimeoutMs,
      });
}

export async function runRevisionThenApprovalScenario(params?: {
  driver?: Driver;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
}): Promise<AgentResearchResult> {
  const runtimeShape = createScenarioRuntimeShape(params);

  const runtime = await run(runtimeShape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(runtimeShape.durable);
  const repository = service.getRepository(runtimeShape.workflow);

  try {
    const executionId = await service.start(runtimeShape.workflow, {
      topic: "durable agent orchestration",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });

    await service.signal(executionId, ReviewDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Strengthen the operations and failure story.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: RevisedDraft.id,
    });

    await service.signal(executionId, RevisedDraft, {
      author: "research-agent",
      summary: "Updated with recovery, audit, replay, and queue-failure details.",
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

    return await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });
  } finally {
    await runtime.dispose();
  }
}

export async function runParallelApprovalScenario(params: {
  count: number;
  driver?: Driver;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  waitTimeoutMs?: number;
}): Promise<AgentResearchResult[]> {
  const runtimeShape = createScenarioRuntimeShape({
    driver: params.driver,
    redisUrl: params.redisUrl,
    rabbitUrl: params.rabbitUrl,
    reviewTimeoutMs: params.reviewTimeoutMs ?? 5_000,
    revisionTimeoutMs: 5_000,
  });
  const runtime = await run(runtimeShape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(runtimeShape.durable);
  const repository = service.getRepository(runtimeShape.workflow);

  try {
    const executionIds = await Promise.all(
      Array.from({ length: params.count }, (_, index) =>
        service.start(runtimeShape.workflow, {
          topic: `parallel-${index + 1}`,
        }),
      ),
    );

    await Promise.all(
      executionIds.map((executionId) =>
        waitForSignalCheckpoint({
          repository,
          executionId,
          signalId: ReviewDecision.id,
        }),
      ),
    );

    const waits = executionIds.map((executionId) =>
      service.wait<AgentResearchResult>(executionId, {
        timeout: params.waitTimeoutMs ?? 10_000,
        waitPollIntervalMs: 20,
      }),
    );

    await Promise.all(
      executionIds.map((executionId, index) =>
        service.signal(executionId, ReviewDecision, {
          decision: "approve",
          reviewer: `parallel-reviewer-${index + 1}@company.com`,
        }),
      ),
    );

    return await Promise.all(waits);
  } finally {
    await runtime.dispose();
  }
}

export async function runParallelMixedReviewScenario(params: {
  count: number;
  driver?: Driver;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
  waitTimeoutMs?: number;
}): Promise<AgentResearchResult[]> {
  const runtimeShape = createScenarioRuntimeShape({
    driver: params.driver,
    redisUrl: params.redisUrl,
    rabbitUrl: params.rabbitUrl,
    reviewTimeoutMs: params.reviewTimeoutMs ?? 5_000,
    revisionTimeoutMs: params.revisionTimeoutMs ?? 5_000,
  });
  const runtime = await run(runtimeShape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(runtimeShape.durable);
  const repository = service.getRepository(runtimeShape.workflow);

  try {
    const executionIds = await Promise.all(
      Array.from({ length: params.count }, (_, index) =>
        service.start(runtimeShape.workflow, {
          topic: `mixed-${index + 1}`,
        }),
      ),
    );

    await Promise.all(
      executionIds.map((executionId) =>
        waitForSignalCheckpoint({
          repository,
          executionId,
          signalId: ReviewDecision.id,
        }),
      ),
    );

    const waits = executionIds.map((executionId) =>
      service.wait<AgentResearchResult>(executionId, {
        timeout: params.waitTimeoutMs ?? 10_000,
        waitPollIntervalMs: 20,
      }),
    );

    const revisionIds: string[] = [];

    await Promise.all(
      executionIds.map(async (executionId, index) => {
        if (index % 3 === 0) {
          revisionIds.push(executionId);
          await service.signal(executionId, ReviewDecision, {
            decision: "revise",
            reviewer: `editor-${index + 1}@company.com`,
            feedback:
              index % 2 === 0 ? `Tighten claim set ${index + 1}` : undefined,
          });
          return;
        }

        await service.signal(executionId, ReviewDecision, {
          decision: "approve",
          reviewer: `editor-${index + 1}@company.com`,
        });
      }),
    );

    await Promise.all(
      revisionIds.map((executionId) =>
        waitForSignalCheckpoint({
          repository,
          executionId,
          signalId: RevisedDraft.id,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId, index) =>
        service.signal(executionId, RevisedDraft, {
          author: `research-agent-${index + 1}`,
          summary: `Revised summary ${index + 1} with stronger operational detail.`,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId) =>
        waitForSignalCheckpoint({
          repository,
          executionId,
          signalId: ReviewDecision.id,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId, index) =>
        service.signal(executionId, ReviewDecision, {
          decision: "approve",
          reviewer: `final-editor-${index + 1}@company.com`,
        }),
      ),
    );

    return await Promise.all(waits);
  } finally {
    await runtime.dispose();
  }
}

export async function runDemoFromEnv(): Promise<AgentResearchResult> {
  const runtimeShape = getRuntimeFromEnv();
  const runtime = await run(runtimeShape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(runtimeShape.durable);
  const repository = service.getRepository(runtimeShape.workflow);

  try {
    const executionId = await service.start(runtimeShape.workflow, {
      topic: "durable agent orchestration",
    });
    console.log(`Started execution: ${executionId}`);

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });
    console.log("Waiting for review, sending revise...");

    await service.signal(executionId, ReviewDecision, {
      decision: "revise",
      reviewer: "editor@company.com",
      feedback: "Please make it more production-shaped.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: RevisedDraft.id,
    });
    console.log("Waiting for revised draft, sending update...");

    await service.signal(executionId, RevisedDraft, {
      author: "research-agent",
      summary: "Revised brief with Redis, RabbitMQ, failures, and audits.",
    });

    await waitForSignalCheckpoint({
      repository,
      executionId,
      signalId: ReviewDecision.id,
    });
    console.log("Waiting for final review, sending approval...");

    await service.signal(executionId, ReviewDecision, {
      decision: "approve",
      reviewer: "editor@company.com",
    });

    const result = await service.wait<AgentResearchResult>(executionId, {
      timeout: 10_000,
      waitPollIntervalMs: 20,
    });
    console.log("Workflow result:", result);

    return result;
  } finally {
    await runtime.dispose();
  }
}
