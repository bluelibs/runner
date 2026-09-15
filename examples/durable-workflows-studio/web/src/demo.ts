/**
 * Demo-mode studio: an in-memory simulator behind the same `StudioApi`
 * interface, so `?demo=1` renders the full experience without a backend.
 *
 * Started executions genuinely progress node by node and park on signal
 * waits until the user delivers a signal through the UI.
 */
import type {
  StudioAuditEntry,
  StudioExecutionDetail,
  StudioExecutionPage,
  StudioExecutionStatus,
  StudioExecutionSummary,
  StudioSchedule,
  StudioTimelineNode,
  StudioWorkflow,
} from "../../src/shared/types.js";
import { ApiError, type ExecutionFilters, type StudioApi } from "./api.js";
import { DEMO_WORKFLOWS } from "./demoWorkflows.js";
import { buildScaleExecutionDetails } from "./scaleDemo.js";

let sequence = 100;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function previewDailyCron(expression: string, timezone: unknown): string[] {
  const match = expression.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match || (timezone !== undefined && timezone !== "UTC")) {
    throw new ApiError(
      400,
      "This offline demo previews daily UTC cron expressions; the live API supports full cron syntax and IANA timezones.",
    );
  }
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) {
    throw new ApiError(400, "Invalid cron expression.");
  }
  const first = new Date();
  first.setUTCSeconds(0, 0);
  first.setUTCHours(hour, minute, 0, 0);
  if (first.getTime() <= Date.now()) first.setUTCDate(first.getUTCDate() + 1);
  return [0, 1, 2].map((days) =>
    new Date(first.getTime() + days * 86_400_000).toISOString(),
  );
}

function cannedResult(nodeId: string, input: unknown): unknown {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  switch (nodeId) {
    case "validateOrder":
      return { ...data, validatedAt: Date.now() };
    case "chargeCustomer":
      return { chargeId: `chg_${String(data.orderId ?? "demo")}`, charged: data.amount ?? 0 };
    case "shipOrder":
      return {
        orderId: String(data.orderId ?? "demo"),
        transactionId: "txn_demo_123",
        status: "shipped",
        shippedAt: Date.now(),
      };
    case "createAccount":
      return {
        userId: `user_${sequence}`,
        email: data.email ?? "demo@example.com",
        plan: data.plan ?? "pro",
      };
    case "provisionResources":
      return `workspace_user_${sequence}`;
    case "diagnose":
      return { rootCause: "saturated connection pool", confidence: 0.86 };
    case "closeIncident":
      return { outcome: "resolved", closedAt: Date.now() };
    default:
      return { ok: true, at: Date.now() };
  }
}

function cannedFinalResult(workflowKey: string, input: unknown): unknown {
  const data = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  if (workflowKey === "processOrder") {
    return {
      orderId: String(data.orderId ?? "demo"),
      transactionId: "txn_demo_123",
      status: "shipped",
      shippedAt: Date.now(),
    };
  }
  if (workflowKey === "userOnboarding") {
    return {
      userId: `user_${sequence}`,
      email: data.email ?? "demo@example.com",
      plan: data.plan ?? "pro",
      verified: true,
      workspace: `workspace_user_${sequence}`,
      completedAt: Date.now(),
    };
  }
  return {
    incidentId: String(data.incidentId ?? "demo"),
    outcome: "resolved",
    severity: data.severity ?? "SEV-2",
    closedAt: Date.now(),
  };
}

interface Simulation {
  detail: StudioExecutionDetail;
  workflow: StudioWorkflow;
  timers: number[];
  listeners: Set<(detail: StudioExecutionDetail) => void>;
  auditSequence: number;
}

function blankTimeline(workflow: StudioWorkflow): StudioTimelineNode[] {
  return workflow.graph.nodes.map((node) => ({
    ...node,
    state: "pending",
    branchTaken: null,
    result: null,
    completedAt: null,
    wait: null,
  }));
}

function pushAudit(
  sim: Simulation,
  kind: string,
  detail: Record<string, unknown>,
): void {
  sim.auditSequence += 1;
  const entry: StudioAuditEntry = {
    id: `audit_${sim.auditSequence}`,
    at: iso(),
    kind,
    attempt: 1,
    detail,
  };
  sim.detail = {
    ...sim.detail,
    audit: [...sim.detail.audit, entry],
    updatedAt: iso(),
  };
}

function recordSignal(
  sim: Simulation,
  signalId: string,
  payload: unknown,
  state: "queued" | "consumed",
): void {
  const existing = sim.detail.signals.find(
    (journal) => journal.signalId === signalId,
  );
  const record = {
    id: `signal_${sequence}_${Date.now()}`,
    payload,
    receivedAt: iso(),
    state,
  } as const;
  sim.detail = {
    ...sim.detail,
    signals: existing
      ? sim.detail.signals.map((journal) =>
          journal.signalId === signalId
            ? { ...journal, history: [...journal.history, record] }
            : journal,
        )
      : [...sim.detail.signals, { signalId, history: [record] }],
  };
}

function notify(sim: Simulation): void {
  sim.detail = { ...sim.detail, updatedAt: iso() };
  sim.detail.steps = sim.detail.timeline
    .filter((node) => node.completedAt !== null)
    .map((node) => ({
      stepId: node.id,
      result: node.result,
      completedAt: node.completedAt as string,
    }));
  for (const listener of sim.listeners) listener(sim.detail);
}

function setNode(
  sim: Simulation,
  nodeId: string,
  patch: Partial<StudioTimelineNode>,
): void {
  sim.detail = {
    ...sim.detail,
    timeline: sim.detail.timeline.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    ),
  };
}

function takenBranches(sim: Simulation): Map<string, string> {
  const taken = new Map<string, string>();
  for (const node of sim.detail.timeline) {
    if (node.kind === "switch" && node.branchTaken) {
      taken.set(node.id, node.branchTaken);
    }
  }
  return taken;
}

function applySkipped(sim: Simulation): void {
  const taken = takenBranches(sim);
  const incoming = new Map<string, number>();
  for (const node of sim.detail.timeline) incoming.set(node.id, 0);
  for (const edge of sim.detail.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  const queue = sim.detail.timeline
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of sim.detail.edges) {
      if (edge.from !== id) continue;
      if (edge.branch !== undefined) {
        const branch = taken.get(edge.from);
        if (branch !== undefined && branch !== edge.branch) continue;
      }
      queue.push(edge.to);
    }
  }
  for (const node of sim.detail.timeline) {
    if (node.state === "pending" && !reachable.has(node.id)) {
      setNode(sim, node.id, { state: "skipped" });
    }
  }
}

function setStatus(sim: Simulation, status: StudioExecutionStatus): void {
  const from = sim.detail.status;
  sim.detail = {
    ...sim.detail,
    status,
    position: positionFor(sim, status),
    ...(status === "completed" || status === "failed" || status === "cancelled"
      ? { completedAt: iso() }
      : {}),
  };
  pushAudit(sim, "execution_status_changed", { from, to: status });
}

function positionFor(sim: Simulation, status: StudioExecutionStatus): string | null {
  const waiting = sim.detail.timeline.find((node) => node.state === "waiting");
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") {
    const failed = sim.detail.timeline.find((node) => node.state === "failed");
    return `Failed at \`${failed?.id ?? "unknown"}\`: ${sim.detail.error?.message ?? "error"}`;
  }
  if (waiting?.kind === "signal") {
    return `Waiting for signal \`${waiting.wait?.signalId ?? "unknown"}\``;
  }
  if (waiting?.kind === "sleep") return `Sleeping at \`${waiting.id}\``;
  const active = sim.detail.timeline.find((node) => node.state === "active");
  if (active) return `Running step \`${active.id}\``;
  if (status === "running") return "Running";
  return null;
}

function later(sim: Simulation, ms: number, fn: () => void): void {
  sim.timers.push(window.setTimeout(() => fn(), ms));
}

function clearTimers(sim: Simulation): void {
  for (const timer of sim.timers) window.clearTimeout(timer);
  sim.timers = [];
}

function finish(sim: Simulation): void {
  sim.detail = {
    ...sim.detail,
    result: cannedFinalResult(sim.workflow.key, sim.detail.input),
  };
  setStatus(sim, "completed");
  notify(sim);
}

/** Advances the simulation by completing the next pending node. */
function advance(sim: Simulation): void {
  if (
    sim.detail.status === "cancelled" ||
    sim.detail.status === "failed" ||
    sim.detail.status === "completed"
  ) {
    return;
  }
  const next = sim.detail.timeline.find((node) => node.state === "pending");
  if (!next) {
    finish(sim);
    return;
  }
  if (next.kind === "signal") {
    const queuedRecord = sim.detail.signals
      .find((journal) => journal.signalId === next.signal)
      ?.history.find((record) => record.state === "queued");
    if (queuedRecord) {
      sim.detail = {
        ...sim.detail,
        signals: sim.detail.signals.map((journal) => ({
          ...journal,
          history: journal.history.map((record) =>
            record.id === queuedRecord.id
              ? { ...record, state: "consumed" as const }
              : record,
          ),
        })),
      };
      setNode(sim, next.id, {
        state: "completed",
        result: {
          state: "completed",
          signalId: next.signal,
          payload: queuedRecord.payload,
        },
        completedAt: iso(),
        wait: null,
      });
      pushAudit(sim, "signal_delivered", {
        stepId: next.id,
        signalId: next.signal,
      });
      notify(sim);
      advance(sim);
      return;
    }
    setNode(sim, next.id, {
      state: "waiting",
      wait: { signalId: next.signal, timeoutAtMs: Date.now() + 120_000 },
    });
    setStatus(sim, "sleeping");
    pushAudit(sim, "signal_waiting", {
      stepId: next.id,
      signalId: next.signal,
      timeoutMs: 120_000,
    });
    notify(sim);
    return;
  }
  if (next.kind === "sleep") {
    setNode(sim, next.id, {
      state: "waiting",
      wait: { fireAtMs: Date.now() + 2500 },
    });
    setStatus(sim, "sleeping");
    notify(sim);
    later(sim, 2500, () => {
      setNode(sim, next.id, {
        state: "completed",
        result: { state: "completed" },
        completedAt: iso(),
        wait: null,
      });
      pushAudit(sim, "sleep_completed", { stepId: next.id });
      setStatus(sim, "running");
      notify(sim);
      advance(sim);
    });
    return;
  }
  if (next.kind === "switch") {
    setNode(sim, next.id, { state: "active" });
    setStatus(sim, "running");
    notify(sim);
    later(sim, 900, () => {
      const branch = next.branches?.[0] ?? "taken";
      setNode(sim, next.id, {
        state: "completed",
        branchTaken: branch,
        result: { branchId: branch, result: branch },
        completedAt: iso(),
      });
      pushAudit(sim, "switch_evaluated", { stepId: next.id, branchId: branch });
      applySkipped(sim);
      notify(sim);
      advance(sim);
    });
    return;
  }
  setNode(sim, next.id, { state: "active" });
  setStatus(sim, "running");
  notify(sim);
  later(sim, 1100, () => {
    setNode(sim, next.id, {
      state: "completed",
      result: cannedResult(next.id, sim.detail.input),
      completedAt: iso(),
    });
    pushAudit(sim, "step_completed", { stepId: next.id, durationMs: 1100 });
    notify(sim);
    advance(sim);
  });
}

function summaryOf(detail: StudioExecutionDetail): StudioExecutionSummary {
  return {
    id: detail.id,
    workflowKey: detail.workflowKey,
    workflowTitle: detail.workflowTitle,
    status: detail.status,
    attempt: detail.attempt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    completedAt: detail.completedAt,
    position: detail.position,
    ...(detail.parentExecutionId
      ? { parentExecutionId: detail.parentExecutionId }
      : {}),
  };
}

export const DEMO_TOKEN = "admin";

export function createDemoApi(options: { locked?: boolean } = {}): StudioApi {
  let locked = options.locked ?? false;
  function requireUnlocked(): void {
    if (locked) {
      throw new ApiError(401, "Studio is locked. Enter the admin token to continue.");
    }
  }
  const simulations = new Map<string, Simulation>();
  let schedules: StudioSchedule[] = [
    {
      id: "nightly-reconciliation",
      workflowKey: "processOrder",
      workflowTitle: "Order processing",
      type: "cron",
      pattern: "0 2 * * *",
      input: { orderId: "ORD-NIGHTLY", customerId: "CUST-OPS", amount: 1 },
      status: "active",
      lastRun: iso(-86_400_000),
      nextRun: iso(43_200_000),
      createdAt: iso(-604_800_000),
      updatedAt: iso(-86_400_000),
    },
    {
      id: "drip-reminders",
      workflowKey: "userOnboarding",
      workflowTitle: "User onboarding",
      type: "interval",
      pattern: "3600000",
      input: { email: "drip@example.com", plan: "free" },
      status: "paused",
      lastRun: iso(-7_200_000),
      nextRun: null,
      createdAt: iso(-1_209_600_000),
      updatedAt: iso(-3_600_000),
    },
  ];

  function createSimulation(
    workflow: StudioWorkflow,
    input: unknown,
    id: string,
  ): Simulation {
    const now = iso();
    const sim: Simulation = {
      workflow,
      timers: [],
      listeners: new Set(),
      auditSequence: 0,
      detail: {
        id,
        workflowKey: workflow.key,
        workflowTitle: workflow.title,
        status: "pending",
        attempt: 1,
        maxAttempts: 3,
        input,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        position: null,
        timeline: blankTimeline(workflow),
        edges: workflow.graph.edges,
        steps: [],
        audit: [],
        signals: [],
        relations: { parent: null, children: [] },
      },
    };
    simulations.set(id, sim);
    return sim;
  }

  function requireSim(id: string): Simulation {
    const sim = simulations.get(id);
    if (!sim) throw new ApiError(404, `Unknown execution '${id}'.`);
    return sim;
  }

  // Seed: a completed order, a failed chaos run, and a live incident parked
  // on its approval wait. A fresh onboarding starts itself for live motion.
  const order = DEMO_WORKFLOWS[0]!;
  const onboarding = DEMO_WORKFLOWS[1]!;
  const incident = DEMO_WORKFLOWS[2]!;

  const seedOrder = createSimulation(
    order,
    { orderId: "ORD-1042", customerId: "CUST-7", amount: 249.99 },
    "demo_ord_completed",
  );
  seedOrder.detail = {
    ...seedOrder.detail,
    status: "completed",
    position: "Completed",
    result: {
      orderId: "ORD-1042",
      transactionId: "txn_live_881",
      status: "shipped",
      shippedAt: Date.now() - 3_600_000,
    },
    createdAt: iso(-7_200_000),
    updatedAt: iso(-3_600_000),
    completedAt: iso(-3_600_000),
    timeline: seedOrder.detail.timeline.map((node) => ({
      ...node,
      state: "completed",
      result:
        node.kind === "signal"
          ? { state: "completed", signalId: node.signal, payload: { transactionId: "txn_live_881" } }
          : node.kind === "sleep"
            ? { state: "completed" }
            : cannedResult(node.id, seedOrder.detail.input),
      completedAt: iso(-3_700_000),
    })),
    audit: [
      { id: "a1", at: iso(-7_200_000), kind: "execution_status_changed", attempt: 1, detail: { from: null, to: "running" } },
      { id: "a2", at: iso(-7_199_000), kind: "step_completed", attempt: 1, detail: { stepId: "validateOrder", durationMs: 12 } },
      { id: "a3", at: iso(-7_198_000), kind: "step_completed", attempt: 1, detail: { stepId: "chargeCustomer", durationMs: 88 } },
      { id: "a4", at: iso(-7_197_000), kind: "sleep_scheduled", attempt: 1, detail: { stepId: "__sleep:processingDelay", durationMs: 3000 } },
      { id: "a5", at: iso(-7_194_000), kind: "sleep_completed", attempt: 1, detail: { stepId: "__sleep:processingDelay" } },
      { id: "a6", at: iso(-7_193_000), kind: "signal_waiting", attempt: 1, detail: { stepId: "__signal:awaitPaymentConfirmation", signalId: "paymentConfirmed" } },
      { id: "a7", at: iso(-3_700_000), kind: "signal_delivered", attempt: 1, detail: { stepId: "__signal:awaitPaymentConfirmation", signalId: "paymentConfirmed" } },
      { id: "a8", at: iso(-3_699_000), kind: "step_completed", attempt: 1, detail: { stepId: "shipOrder", durationMs: 31 } },
      { id: "a9", at: iso(-3_600_000), kind: "execution_status_changed", attempt: 1, detail: { from: "running", to: "completed" } },
    ],
    signals: [
      {
        signalId: "paymentConfirmed",
        history: [
          {
            id: "sig_payment_settled",
            payload: { transactionId: "txn_live_881" },
            receivedAt: iso(-3_700_000),
            state: "consumed",
          },
        ],
      },
    ],
  };
  notify(seedOrder);

  const seedFailed = createSimulation(
    incident,
    { incidentId: "INC-CHAOS", severity: "SEV-1", summary: "Chaos drill", chaos: true },
    "demo_inc_failed",
  );
  for (const node of seedFailed.detail.timeline) {
    if (["triageAlert", "pageOnCall"].includes(node.id)) {
      setNode(seedFailed, node.id, {
        state: "completed",
        result: cannedResult(node.id, seedFailed.detail.input),
        completedAt: iso(-900_000),
      });
    } else if (node.id === "__signal:awaitAck") {
      setNode(seedFailed, node.id, {
        state: "completed",
        result: {
          state: "completed",
          signalId: "incidentAcknowledged",
          payload: { acknowledgedBy: "ada@acme.dev", acknowledgedAt: Date.now() - 800_000 },
        },
        completedAt: iso(-850_000),
      });
    } else if (node.id === "ackBranch") {
      setNode(seedFailed, node.id, {
        state: "completed",
        branchTaken: "acked",
        result: { branchId: "acked", result: "acked" },
        completedAt: iso(-825_000),
      });
    } else if (node.id === "diagnose") {
      setNode(seedFailed, node.id, { state: "failed" });
    } else if (node.id === "escalate") {
      setNode(seedFailed, node.id, { state: "skipped" });
    } else {
      setNode(seedFailed, node.id, { state: "unreached" });
    }
  }
  seedFailed.detail = {
    ...seedFailed.detail,
    status: "failed",
    position: "Failed at `diagnose`: Runbook exploded (chaos mode)",
    error: {
      message: "Runbook exploded (chaos mode)",
      stepId: "diagnose",
    },
    createdAt: iso(-1_000_000),
    updatedAt: iso(-800_000),
    completedAt: iso(-800_000),
  };
  notify(seedFailed);

  const seedLive = createSimulation(
    incident,
    { incidentId: "INC-2077", severity: "SEV-2", summary: "Checkout latency above SLO" },
    "demo_inc_live",
  );
  const liveCompleted: Record<string, unknown> = {
    triageAlert: cannedResult("triageAlert", seedLive.detail.input),
    pageOnCall: cannedResult("pageOnCall", seedLive.detail.input),
    "__signal:awaitAck": {
      state: "completed",
      signalId: "incidentAcknowledged",
      payload: { acknowledgedBy: "ada@acme.dev", acknowledgedAt: Date.now() - 240_000 },
    },
    ackBranch: { branchId: "acked", result: "acked" },
    diagnose: cannedResult("diagnose", seedLive.detail.input),
  };
  for (const node of seedLive.detail.timeline) {
    if (node.id in liveCompleted) {
      setNode(seedLive, node.id, {
        state: "completed",
        result: liveCompleted[node.id],
        completedAt: iso(-200_000),
        ...(node.kind === "switch" ? { branchTaken: "acked" } : {}),
      });
    } else if (node.id === "__signal:awaitApproval") {
      setNode(seedLive, node.id, {
        state: "waiting",
        wait: { signalId: "approvalDecision", timeoutAtMs: Date.now() + 1_800_000 },
      });
    } else if (node.id === "escalate") {
      setNode(seedLive, node.id, { state: "skipped" });
    }
  }
  seedLive.detail = {
    ...seedLive.detail,
    status: "sleeping",
    position: "Waiting for signal `approvalDecision`",
    createdAt: iso(-400_000),
    audit: [
      { id: "b1", at: iso(-400_000), kind: "execution_status_changed", attempt: 1, detail: { from: null, to: "running" } },
      { id: "b2", at: iso(-399_000), kind: "step_completed", attempt: 1, detail: { stepId: "triageAlert", durationMs: 9 } },
      { id: "b3", at: iso(-398_000), kind: "step_completed", attempt: 1, detail: { stepId: "pageOnCall", durationMs: 41 } },
      { id: "b4", at: iso(-397_000), kind: "signal_waiting", attempt: 1, detail: { stepId: "__signal:awaitAck", signalId: "incidentAcknowledged" } },
      { id: "b5", at: iso(-240_000), kind: "signal_delivered", attempt: 1, detail: { stepId: "__signal:awaitAck", signalId: "incidentAcknowledged" } },
      { id: "b6", at: iso(-239_000), kind: "switch_evaluated", attempt: 1, detail: { stepId: "ackBranch", branchId: "acked" } },
      { id: "b7", at: iso(-238_000), kind: "step_completed", attempt: 1, detail: { stepId: "diagnose", durationMs: 812 } },
      { id: "b8", at: iso(-237_000), kind: "note", attempt: 1, detail: { message: "Diagnosis for INC-2077: saturated connection pool" } },
      { id: "b9", at: iso(-236_000), kind: "signal_waiting", attempt: 1, detail: { stepId: "__signal:awaitApproval", signalId: "approvalDecision" } },
    ],
    signals: [
      {
        signalId: "incidentAcknowledged",
        history: [
          {
            id: "sig_ack_primary",
            payload: {
              acknowledgedBy: "ada@acme.dev",
              acknowledgedAt: Date.now() - 240_000,
            },
            receivedAt: iso(-240_000),
            state: "consumed",
          },
          {
            id: "sig_ack_duplicate",
            payload: {
              acknowledgedBy: "backup@acme.dev",
              acknowledgedAt: Date.now() - 120_000,
            },
            receivedAt: iso(-120_000),
            state: "queued",
          },
        ],
      },
    ],
  };
  notify(seedLive);

  // A fresh onboarding that visibly progresses on load, then parks on email.
  const seedRunner = createSimulation(
    onboarding,
    { email: "ada@example.com", plan: "pro" },
    "demo_onb_live",
  );
  later(seedRunner, 600, () => advance(seedRunner));

  // Parent/child fixture: two regional loops are complete while APAC is on
  // its final iteration, leaving the parent visibly parked on the join.
  const portfolio = DEMO_WORKFLOWS.find(
    (workflow) => workflow.key === "portfolioReconciliation",
  )!;
  const rollup = DEMO_WORKFLOWS.find(
    (workflow) => workflow.key === "regionalRollup",
  )!;
  const seedPortfolio = createSimulation(
    portfolio,
    { portfolioId: "PORT-Q3", ordersPerBatch: 120 },
    "demo_portfolio_live",
  );
  seedPortfolio.detail = {
    ...seedPortfolio.detail,
    status: "sleeping",
    position: "Waiting for execution `demo_rollup_apac`",
    createdAt: iso(-520_000),
    timeline: seedPortfolio.detail.timeline.map((node) => ({
      ...node,
      state:
        node.id === "join:apac"
          ? "waiting"
          : node.id === "publishPortfolio"
            ? "pending"
            : "completed",
      result: node.id.startsWith("spawn:")
        ? `demo_rollup_${node.id.split(":")[1]}`
        : node.id === "join:apac"
          ? { state: "waiting", targetExecutionId: "demo_rollup_apac" }
          : { ok: true },
      completedAt:
        node.id === "join:apac" || node.id === "publishPortfolio"
          ? null
          : iso(-480_000),
      wait:
        node.id === "join:apac"
          ? { targetExecutionId: "demo_rollup_apac" }
          : null,
    })),
    audit: [
      {
        id: "p1",
        at: iso(-520_000),
        kind: "execution_status_changed",
        attempt: 1,
        detail: { from: null, to: "running" },
      },
      {
        id: "p2",
        at: iso(-480_000),
        kind: "note",
        attempt: 1,
        detail: { message: "Started EU, US, and APAC regional children" },
      },
    ],
  };

  const childSims = (["eu", "us", "apac"] as const).map((region) => {
    const child = createSimulation(
      rollup,
      { region, batches: 3, ordersPerBatch: 120 },
      `demo_rollup_${region}`,
    );
    const live = region === "apac";
    child.detail = {
      ...child.detail,
      parentExecutionId: seedPortfolio.detail.id,
      status: live ? "running" : "completed",
      position: live ? "Running step `processBatch:3`" : "Completed",
      result: live
        ? null
        : { region, batches: 3, ordersProcessed: 360 },
      createdAt: iso(live ? -480_000 : -7_200_000),
      updatedAt: iso(live ? -30_000 : -300_000),
      completedAt: live ? null : iso(-300_000),
      timeline: child.detail.timeline.map((node, index) => ({
        ...node,
        state: live && index === 2 ? "active" : "completed",
        result: live && index === 2 ? null : 120,
        completedAt: live && index === 2 ? null : iso(-320_000 + index * 5000),
      })),
      audit: [1, 2, ...(live ? [] : [3])].map((batch) => ({
        id: `audit_${region}_${batch}`,
        at: iso(-400_000 + batch * 5000),
        kind: "step_completed",
        attempt: 1,
        detail: { stepId: `processBatch:${batch}`, durationMs: 34 + batch },
      })),
    };
    notify(child);
    return child;
  });
  seedPortfolio.detail = {
    ...seedPortfolio.detail,
    relations: {
      parent: null,
      children: childSims.map((child) => summaryOf(child.detail)),
    },
  };
  const portfolioSummary = summaryOf(seedPortfolio.detail);
  for (const child of childSims) {
    child.detail = {
      ...child.detail,
      relations: { parent: portfolioSummary, children: [] },
    };
  }
  notify(seedPortfolio);

  for (const detail of buildScaleExecutionDetails(
    DEMO_WORKFLOWS,
    [...simulations.values()].map((simulation) => simulation.detail),
  )) {
    const workflow = DEMO_WORKFLOWS.find(
      (candidate) => candidate.key === detail.workflowKey,
    );
    if (!workflow) {
      throw new Error(`Scale fixture references unknown workflow '${detail.workflowKey}'.`);
    }
    simulations.set(detail.id, {
      detail,
      workflow,
      timers: [],
      listeners: new Set(),
      auditSequence: 0,
    });
  }

  function executionPage(
    filters: ExecutionFilters = {},
  ): StudioExecutionPage {
    let details = [...simulations.values()].map((simulation) => simulation.detail);
    if (filters.workflowKey) {
      details = details.filter(
        (detail) => detail.workflowKey === filters.workflowKey,
      );
    }
    if (filters.status) {
      details = details.filter((detail) => detail.status === filters.status);
    }
    details.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    const page = details.slice(offset, offset + limit);
    const hasMore = offset + page.length < details.length;
    return {
      executions: page.map(summaryOf),
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
      total: details.length,
    };
  }

  return {
    listWorkflows: async () => {
      requireUnlocked();
      return DEMO_WORKFLOWS;
    },
    listExecutions: async (filters) => {
      requireUnlocked();
      return executionPage(filters).executions;
    },
    listExecutionPage: async (filters) => {
      requireUnlocked();
      return executionPage(filters);
    },
    getExecution: async (id) => {
      requireUnlocked();
      return requireSim(id).detail;
    },
    startExecution: async (workflow, input) => {
      requireUnlocked();
      const found = DEMO_WORKFLOWS.find((w) => w.key === workflow);
      if (!found) throw new ApiError(400, `Unknown workflow '${workflow}'.`);
      sequence += 1;
      const id = `demo_${sequence.toString(36)}_${Date.now().toString(36)}`;
      const sim = createSimulation(found, input, id);
      later(sim, 400, () => advance(sim));
      return id;
    },
    sendSignal: async (id, signal, payload) => {
      requireUnlocked();
      const sim = requireSim(id);
      const waiting = sim.detail.timeline.find(
        (node) => node.state === "waiting" && node.wait?.signalId === signal,
      );
      if (
        sim.detail.status === "completed" ||
        sim.detail.status === "failed" ||
        sim.detail.status === "cancelled"
      ) {
        throw new ApiError(409, `Execution '${id}' is already ${sim.detail.status}.`);
      }
      if (!waiting) {
        recordSignal(sim, signal, payload, "queued");
        notify(sim);
        return;
      }
      recordSignal(sim, signal, payload, "consumed");
      setNode(sim, waiting.id, {
        state: "completed",
        result: { state: "completed", signalId: signal, payload },
        completedAt: iso(),
        wait: null,
      });
      pushAudit(sim, "signal_delivered", { stepId: waiting.id, signalId: signal });
      setStatus(sim, "running");
      notify(sim);
      advance(sim);
    },
    cancelExecution: async (id) => {
      requireUnlocked();
      const sim = requireSim(id);
      if (
        sim.detail.status === "completed" ||
        sim.detail.status === "failed" ||
        sim.detail.status === "cancelled"
      ) {
        throw new ApiError(409, `Execution '${id}' is already ${sim.detail.status}.`);
      }
      clearTimers(sim);
      for (const node of sim.detail.timeline) {
        if (node.state === "pending" || node.state === "waiting" || node.state === "active") {
          setNode(sim, node.id, { state: "unreached", wait: null });
        }
      }
      setStatus(sim, "cancelled");
      notify(sim);
    },
    retryExecution: async (id) => {
      requireUnlocked();
      const sim = requireSim(id);
      if (
        sim.detail.status !== "failed" &&
        sim.detail.status !== "cancelled"
      ) {
        throw new ApiError(409, "Only failed or cancelled executions can be retried.");
      }
      clearTimers(sim);
      sim.detail = {
        ...sim.detail,
        status: "pending",
        attempt: sim.detail.attempt + 1,
        error: null,
        result: null,
        completedAt: null,
        timeline: blankTimeline(sim.workflow),
      };
      notify(sim);
      later(sim, 400, () => advance(sim));
    },
    forceFailExecution: async (id, reason) => {
      requireUnlocked();
      const sim = requireSim(id);
      if (
        sim.detail.status === "completed" ||
        sim.detail.status === "failed" ||
        sim.detail.status === "cancelled"
      ) {
        throw new ApiError(409, `Execution '${id}' is already ${sim.detail.status}.`);
      }
      clearTimers(sim);
      const gap = sim.detail.timeline.find((node) => node.state !== "completed" && node.state !== "skipped");
      sim.detail = { ...sim.detail, error: { message: reason } };
      if (gap) setNode(sim, gap.id, { state: "failed", wait: null });
      for (const node of sim.detail.timeline) {
        if (node.state === "pending" || node.state === "waiting" || node.state === "active") {
          setNode(sim, node.id, { state: "unreached", wait: null });
        }
      }
      setStatus(sim, "failed");
      notify(sim);
    },
    skipStep: async (id, stepId, reason) => {
      requireUnlocked();
      const sim = requireSim(id);
      const node = sim.detail.timeline.find((item) => item.id === stepId);
      if (!node) throw new ApiError(400, `Unknown step '${stepId}'.`);
      setNode(sim, stepId, {
        state: "completed",
        result: { skipped: true, manual: true },
        completedAt: iso(),
        wait: null,
      });
      pushAudit(sim, "note", {
        message: "Operator skipped a step",
        meta: { stepId, reason },
      });
      notify(sim);
    },
    editState: async (id, stepId, result, reason) => {
      requireUnlocked();
      const sim = requireSim(id);
      const node = sim.detail.timeline.find((item) => item.id === stepId);
      if (!node) throw new ApiError(400, `Unknown step '${stepId}'.`);
      setNode(sim, stepId, {
        state: "completed",
        result,
        completedAt: node.completedAt ?? iso(),
      });
      pushAudit(sim, "note", {
        message: "Operator edited step state",
        meta: { stepId, reason },
      });
      notify(sim);
    },
    listSchedules: async () => {
      requireUnlocked();
      return schedules;
    },
    createSchedule: async (body) => {
      requireUnlocked();
      sequence += 1;
      const id = typeof body.id === "string" ? body.id : `sch_${sequence.toString(36)}`;
      const workflow = DEMO_WORKFLOWS.find((w) => w.key === body.workflow);
      if (!workflow) throw new ApiError(400, "Unknown workflow.");
      schedules = [
        ...schedules,
        {
          id,
          workflowKey: workflow.key,
          workflowTitle: workflow.title,
          type: typeof body.cron === "string" ? "cron" : "interval",
          pattern: String(body.cron ?? body.interval ?? ""),
          input: body.input ?? null,
          status: "active",
          lastRun: null,
          nextRun: iso(3_600_000),
          createdAt: iso(),
          updatedAt: iso(),
        },
      ];
      return id;
    },
    previewSchedule: async (body) => {
      requireUnlocked();
      const interval = Number(body.interval ?? body.delay);
      if (Number.isFinite(interval) && interval > 0) {
        const count = body.delay === undefined ? 3 : 1;
        return Array.from({ length: count }, (_, index) =>
          iso(interval * (index + 1)),
        );
      }
      if (typeof body.at === "string" && !Number.isNaN(Date.parse(body.at))) {
        return [new Date(body.at).toISOString()];
      }
      if (typeof body.cron === "string" && body.cron.trim() !== "") {
        return previewDailyCron(body.cron, body.timezone);
      }
      throw new ApiError(400, "Invalid schedule cadence.");
    },
    updateSchedule: async (id, body) => {
      requireUnlocked();
      if (!schedules.some((schedule) => schedule.id === id)) {
        throw new ApiError(404, `Unknown schedule '${id}'.`);
      }
      schedules = schedules.map((schedule) => {
        if (schedule.id !== id) return schedule;
        const type = typeof body.cron === "string" ? "cron" :
          typeof body.interval === "number" ? "interval" : schedule.type;
        const pattern = String(body.cron ?? body.interval ?? schedule.pattern);
        return {
          ...schedule,
          type,
          pattern,
          ...(Object.prototype.hasOwnProperty.call(body, "input")
            ? { input: body.input }
            : {}),
          updatedAt: iso(),
          nextRun: schedule.status === "active" ? iso(3_600_000) : null,
        };
      });
    },
    pauseSchedule: async (id) => {
      requireUnlocked();
      schedules = schedules.map((s) => (s.id === id ? { ...s, status: "paused", nextRun: null } : s));
    },
    resumeSchedule: async (id) => {
      requireUnlocked();
      schedules = schedules.map((s) =>
        s.id === id ? { ...s, status: "active", nextRun: iso(3_600_000) } : s,
      );
    },
    removeSchedule: async (id) => {
      requireUnlocked();
      schedules = schedules.filter((s) => s.id !== id);
    },
    listStuck: async () => {
      requireUnlocked();
      return [...simulations.values()]
        .map((sim) => sim.detail)
        .filter((detail) => detail.id === "demo_inc_failed")
        .map(summaryOf);
    },
    recover: async () => {
      requireUnlocked();
      return {
        scannedCount: simulations.size,
        recoveredCount: 0,
        skippedCount: simulations.size,
        failedCount: 0,
      };
    },
    subscribeExecution: (id, onDetail) => {
      if (locked) return () => {};
      const sim = simulations.get(id);
      if (!sim) return () => {};
      sim.listeners.add(onDetail);
      onDetail(sim.detail);
      return () => {
        sim.listeners.delete(onDetail);
      };
    },
    unlock: async (token: string) => {
      if (token !== DEMO_TOKEN) {
        throw new ApiError(401, "Invalid token.");
      }
      locked = false;
    },
    isLocked: () => locked,
  };
}
