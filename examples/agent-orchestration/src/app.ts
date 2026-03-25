import { r } from "@bluelibs/runner";
import { resources } from "@bluelibs/runner/node";

import {
  ComplianceDecision,
  ReviewDecision,
  RevisedDraft,
  StressPolicyDecision,
  StressRevisionDraft,
} from "./signals.js";
import {
  createStressAgentWorkflow,
  createResearchAgentWorkflow,
  type WorkflowTimingOptions,
} from "./workflow.js";

export function createMemoryDurableConfig() {
  return {
    queue: { consume: true },
    polling: { interval: 20 },
    recovery: { onStartup: true },
    audit: { enabled: true },
  } as const;
}

export function createRedisDurableConfig(params: {
  namespace?: string;
  redisUrl: string;
  rabbitUrl: string;
}) {
  return {
    namespace: params.namespace,
    redis: { url: params.redisUrl },
    queue: { url: params.rabbitUrl, quorum: true, consume: true },
    polling: { interval: 20 },
    recovery: { onStartup: true },
    audit: { enabled: true },
  } as const;
}

export function buildMemoryAgentApp(
  namespace: string,
  options?: WorkflowTimingOptions,
) {
  const durable = resources.memoryWorkflow.fork(`${namespace}-durable`);
  const workflow = createResearchAgentWorkflow(durable, options);

  const app = r
    .resource(`${namespace}-app`)
    .register([
      resources.durable, // to enable the functionality across runner
      durable.with(createMemoryDurableConfig()),
      workflow,
      ReviewDecision,
      RevisedDraft,
    ])
    .build();

  return { app, durable, workflow } as const;
}

export function buildMemoryStressAgentApp(
  namespace: string,
  options?: WorkflowTimingOptions,
) {
  const durable = resources.memoryWorkflow.fork(`${namespace}-durable`);
  const workflow = createStressAgentWorkflow(durable, options);

  const app = r
    .resource(`${namespace}-app`)
    .register([
      resources.durable,
      durable.with(createMemoryDurableConfig()),
      workflow,
      StressPolicyDecision,
      StressRevisionDraft,
      ComplianceDecision,
    ])
    .build();

  return { app, durable, workflow } as const;
}

export function buildRedisAgentApp(params: {
  namespace: string;
  redisUrl: string;
  rabbitUrl: string;
  timing?: WorkflowTimingOptions;
}) {
  const durable = resources.redisWorkflow.fork(`${params.namespace}-durable`);
  const workflow = createResearchAgentWorkflow(durable, params.timing);

  const app = r
    .resource(`${params.namespace}-app`)
    .register([
      resources.durable,
      durable.with(
        createRedisDurableConfig({
          namespace: params.namespace,
          redisUrl: params.redisUrl,
          rabbitUrl: params.rabbitUrl,
        }),
      ),
      workflow,
      ReviewDecision,
      RevisedDraft,
    ])
    .build();

  return { app, durable, workflow } as const;
}

export function buildRedisStressAgentApp(params: {
  namespace: string;
  redisUrl: string;
  rabbitUrl: string;
  timing?: WorkflowTimingOptions;
}) {
  const durable = resources.redisWorkflow.fork(`${params.namespace}-durable`);
  const workflow = createStressAgentWorkflow(durable, params.timing);

  const app = r
    .resource(`${params.namespace}-app`)
    .register([
      resources.durable,
      durable.with(
        createRedisDurableConfig({
          namespace: params.namespace,
          redisUrl: params.redisUrl,
          rabbitUrl: params.rabbitUrl,
        }),
      ),
      workflow,
      StressPolicyDecision,
      StressRevisionDraft,
      ComplianceDecision,
    ])
    .build();

  return { app, durable, workflow } as const;
}
