/**
 * Studio Runner application: wires the durable backend, workflows and signals
 * into one runnable resource, and exposes the handles the HTTP API needs.
 *
 * Every `bootStudio()` call creates a fresh store, so test suites can boot
 * isolated studios without executions leaking between cases.
 */
import { r, run } from "@bluelibs/runner";
import type {
  DurableOperator,
  DurableResource,
  MemoryStore,
} from "@bluelibs/runner/node";
import {
  DurableOperator as DurableOperatorImpl,
  durableSupportResource,
  MemoryEventBus,
  MemoryStore as MemoryStoreImpl,
} from "@bluelibs/runner/node";
import { incidentResponse } from "../workflows/incidentResponse.js";
import { userOnboarding } from "../workflows/userOnboarding.js";
import { processOrder } from "../workflows/orderProcessing.js";
import { portfolioReconciliation } from "../workflows/portfolioReconciliation.js";
import { regionalRollup } from "../workflows/regionalRollup.js";
import {
  ApprovalDecision,
  EmailVerified,
  IncidentAcknowledged,
  PaymentConfirmed,
} from "../workflows/signals.js";
import { durable } from "./studioIds.js";

export interface StudioHandles {
  durable: DurableResource;
  operator: DurableOperator;
  store: MemoryStore;
  dispose: () => Promise<void>;
}

/** Task definitions keyed by durable workflow key. */
export const TASKS_BY_KEY = {
  processOrder,
  userOnboarding,
  incidentResponse,
  portfolioReconciliation,
  regionalRollup,
} as const;

export type StudioWorkflowKey = keyof typeof TASKS_BY_KEY;

/** Signal definitions keyed by signal id. */
export const SIGNALS_BY_ID = {
  [PaymentConfirmed.id]: PaymentConfirmed,
  [EmailVerified.id]: EmailVerified,
  [IncidentAcknowledged.id]: IncidentAcknowledged,
  [ApprovalDecision.id]: ApprovalDecision,
} as const;

export async function bootStudio(): Promise<StudioHandles> {
  const store = new MemoryStoreImpl();
  const app = r
    .resource("studio")
    .register([
      durableSupportResource,
      durable.with({
        store,
        eventBus: new MemoryEventBus(),
        polling: { interval: 50 },
        recovery: { onStartup: true },
        // The studio's audit tab reads the persisted audit trail.
        audit: { enabled: true },
      }),
      processOrder,
      userOnboarding,
      incidentResponse,
      portfolioReconciliation,
      regionalRollup,
      PaymentConfirmed,
      EmailVerified,
      IncidentAcknowledged,
      ApprovalDecision,
    ])
    .build();

  const runtime = await run(app, { logs: { printThreshold: null } });
  const durableValue = runtime.getResourceValue(durable);
  return {
    durable: durableValue,
    operator: new DurableOperatorImpl(store),
    store,
    dispose: () => runtime.dispose(),
  };
}
