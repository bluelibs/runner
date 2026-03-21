import { run } from "@bluelibs/runner";
import { waitUntil } from "@bluelibs/runner/node";

import {
  buildMemoryStressAgentApp,
  buildRedisStressAgentApp,
} from "./app.js";
import {
  ComplianceDecision,
  StressPolicyDecision,
  StressRevisionDraft,
} from "./signals.js";
import type { StressAgentInput, StressAgentResult } from "./workflow.js";

type Driver = "memory" | "redis";

type StressPlan = "approve" | "revise_then_approve" | "abort" | "cancel" | "reject";

interface StressInstruction {
  lane: StressAgentInput["lane"];
  plan: StressPlan;
}

export type StressScenarioOutcome =
  | StressAgentResult
  | {
      status: "cancelled";
      lane: StressAgentInput["lane"];
      reason: string;
    };

let namespaceCounter = 0;

function createEphemeralNamespace(prefix: string): string {
  namespaceCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${namespaceCounter}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWaitingForSignal(
  value: unknown,
  signalId: string,
): value is { state: "waiting"; signalId: string } {
  return isRecord(value) && value.state === "waiting" && value.signalId === signalId;
}

async function waitForSignalCheckpoint(params: {
  operator: {
    getExecutionDetail(
      executionId: string,
    ): Promise<{ steps: Array<{ result: unknown }> }>;
  };
  executionId: string;
  signalId: string;
}): Promise<void> {
  await waitUntil(
    async () => {
      const detail = await params.operator.getExecutionDetail(params.executionId);
      return detail.steps.some((stepResult) =>
        isWaitingForSignal(stepResult.result, params.signalId),
      );
    },
    { timeoutMs: 10_000, intervalMs: 20 },
  );
}

function buildInstruction(index: number): StressInstruction {
  if (index % 10 === 0) {
    return { lane: "fast", plan: "cancel" };
  }

  if (index % 6 === 0) {
    return { lane: "fast", plan: "abort" };
  }

  if (index % 4 === 0) {
    return { lane: "regulated", plan: "reject" };
  }

  if (index % 3 === 0) {
    return { lane: "careful", plan: "revise_then_approve" };
  }

  return {
    lane: index % 2 === 0 ? "regulated" : "fast",
    plan: "approve",
  };
}

function createRuntimeShape(params: {
  driver?: Driver;
  namespace?: string;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
}) {
  const namespace =
    params.namespace ?? createEphemeralNamespace("agent-orch-stress");

  return params.driver === "redis"
    ? {
        namespace,
        ...buildRedisStressAgentApp({
          namespace,
          redisUrl: params.redisUrl ?? "redis://localhost:6379",
          rabbitUrl: params.rabbitUrl ?? "amqp://localhost",
          timing: {
            reviewTimeoutMs: params.reviewTimeoutMs,
            revisionTimeoutMs: params.revisionTimeoutMs,
          },
        }),
      }
    : {
        namespace,
        ...buildMemoryStressAgentApp(namespace, {
          reviewTimeoutMs: params.reviewTimeoutMs,
          revisionTimeoutMs: params.revisionTimeoutMs,
        }),
      };
}

async function cleanupRedisNamespace(redisUrl: string, namespace: string) {
  const redisModule = await import("ioredis");
  const Redis = redisModule.default as unknown as {
    new (url: string): {
      scan(
        cursor: string,
        ...args: string[]
      ): Promise<[string, string[]]>;
      del(...keys: string[]): Promise<number>;
      disconnect(): void;
    };
  };
  const redis = new Redis(redisUrl);
  const encodedNamespace = encodeURIComponent(namespace);

  const deletePattern = async (pattern: string) => {
    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "200",
      );

      if (keys.length > 0) {
        await redis.del(...keys);
      }

      cursor = nextCursor;
    } while (cursor !== "0");
  };

  try {
    await deletePattern(`durable:${encodedNamespace}:*`);
    await deletePattern(`durable:bus:${encodedNamespace}:*`);
  } finally {
    redis.disconnect();
  }
}

async function cleanupRabbitQueues(rabbitUrl: string, namespace: string) {
  const { connect } = await import("amqplib");
  const encodedNamespace = encodeURIComponent(namespace);
  const queueName = `durable_executions:${encodedNamespace}`;
  const deadLetterQueueName = `durable_executions:dlq:${encodedNamespace}`;
  const connection = await connect(rabbitUrl);

  try {
    const channel = await connection.createChannel();

    try {
      await channel.deleteQueue(deadLetterQueueName);
      await channel.deleteQueue(queueName);
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}

async function cleanupRedisRabbitArtifacts(params: {
  namespace: string;
  redisUrl: string;
  rabbitUrl: string;
}) {
  await cleanupRedisNamespace(params.redisUrl, params.namespace);
  await cleanupRabbitQueues(params.rabbitUrl, params.namespace);
}

export async function runParallelStressScenario(params: {
  count: number;
  driver?: Driver;
  namespace?: string;
  redisUrl?: string;
  rabbitUrl?: string;
  reviewTimeoutMs?: number;
  revisionTimeoutMs?: number;
  waitTimeoutMs?: number;
  cleanup?: boolean;
}): Promise<StressScenarioOutcome[]> {
  const runtimeShape = createRuntimeShape({
    driver: params.driver,
    namespace: params.namespace,
    redisUrl: params.redisUrl,
    rabbitUrl: params.rabbitUrl,
    reviewTimeoutMs: params.reviewTimeoutMs ?? 5_000,
    revisionTimeoutMs: params.revisionTimeoutMs ?? 5_000,
  });
  const runtime = await run(runtimeShape.app, { logs: { printThreshold: null } });
  const service = runtime.getResourceValue(runtimeShape.durable);
  const instructions = Array.from({ length: params.count }, (_, index) =>
    buildInstruction(index + 1),
  );

  try {
    const executionIds = await Promise.all(
      instructions.map((instruction, index) =>
        service.start(runtimeShape.workflow, {
          topic: `stress-${index + 1}`,
          lane: instruction.lane,
        }),
      ),
    );
    const instructionByExecutionId = new Map(
      executionIds.map((executionId, index) => [
        executionId,
        instructions[index],
      ] as const),
    );

    await Promise.all(
      executionIds.map((executionId) =>
        waitForSignalCheckpoint({
          operator: service.operator,
          executionId,
          signalId: StressPolicyDecision.id,
        }),
      ),
    );

    const waits = executionIds.map(async (executionId) => {
      try {
        return {
          status: "fulfilled" as const,
          value: await service.wait<StressAgentResult>(executionId, {
            timeout: params.waitTimeoutMs ?? 10_000,
            waitPollIntervalMs: 20,
          }),
        };
      } catch (error) {
        return {
          status: "rejected" as const,
          reason: error,
        };
      }
    });

    const revisionIds: string[] = [];
    const complianceIds: string[] = [];

    await Promise.all(
      executionIds.map(async (executionId, index) => {
        const instruction = instructions[index];

        if (instruction.plan === "cancel") {
          await service.cancelExecution(executionId, "stress-cancelled");
          return;
        }

        if (instruction.plan === "revise_then_approve") {
          revisionIds.push(executionId);
          await service.signal(executionId, StressPolicyDecision, {
            decision: "revise",
            reviewer: `policy-${index + 1}@company.com`,
            feedback: `Need revision round ${index + 1}`,
          });
          return;
        }

        await service.signal(executionId, StressPolicyDecision, {
          decision: instruction.plan === "abort" ? "abort" : "approve",
          reviewer: `policy-${index + 1}@company.com`,
          feedback:
            instruction.plan === "abort" ? `Abort request ${index + 1}` : undefined,
        });

        if (instruction.lane === "regulated" && instruction.plan !== "abort") {
          complianceIds.push(executionId);
        }
      }),
    );

    await Promise.all(
      revisionIds.map((executionId) =>
        waitForSignalCheckpoint({
          operator: service.operator,
          executionId,
          signalId: StressRevisionDraft.id,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId, index) =>
        service.signal(executionId, StressRevisionDraft, {
          author: "research-agent",
          citations: index + 3,
          summary: `Revised stress draft ${index + 1}`,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId) =>
        waitForSignalCheckpoint({
          operator: service.operator,
          executionId,
          signalId: StressPolicyDecision.id,
        }),
      ),
    );

    await Promise.all(
      revisionIds.map((executionId, index) =>
        service.signal(executionId, StressPolicyDecision, {
          decision: "approve",
          reviewer: `policy-recheck-${index + 1}@company.com`,
        }),
      ),
    );

    complianceIds.push(
      ...revisionIds.filter(
        (executionId) => instructionByExecutionId.get(executionId)?.lane === "regulated",
      ),
    );

    await Promise.all(
      [...new Set(complianceIds)].map((executionId) =>
        waitForSignalCheckpoint({
          operator: service.operator,
          executionId,
          signalId: ComplianceDecision.id,
        }),
      ),
    );

    await Promise.all(
      [...new Set(complianceIds)].map((executionId) => {
        const index = executionIds.indexOf(executionId);
        const instruction = instructionByExecutionId.get(executionId)!;

        return service.signal(executionId, ComplianceDecision, {
          decision: instruction.plan === "reject" ? "reject" : "proceed",
          reviewer: `compliance-${index + 1}@company.com`,
          note:
            instruction.plan === "reject"
              ? "Rejecting risky regulated draft."
              : "Proceed with publication.",
        });
      }),
    );

    const settled = await Promise.all(waits);

    return settled.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      return {
        status: "cancelled",
        lane: instructions[index].lane,
        reason: String(result.reason),
      };
    });
  } finally {
    await runtime.dispose();

    if (params.driver === "redis" && params.cleanup !== false) {
      await cleanupRedisRabbitArtifacts({
        namespace: runtimeShape.namespace,
        redisUrl: params.redisUrl ?? "redis://localhost:6379",
        rabbitUrl: params.rabbitUrl ?? "amqp://localhost",
      });
    }
  }
}
