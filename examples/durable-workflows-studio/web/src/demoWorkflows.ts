/**
 * Demo-mode workflow catalog fixtures.
 *
 * Mirrors the server catalog (same keys, node ids and signals) so the offline
 * demo renders exactly what the live studio shows.
 */
import type { StudioWorkflow } from "../../src/shared/types.js";
import { OPERATIONS_WORKFLOWS } from "../../src/workflows/operationsCatalog.js";
import { buildScaleWorkflows } from "./scaleDemoWorkflows.js";

const CORE_DEMO_WORKFLOWS: StudioWorkflow[] = [
  {
    key: "processOrder",
    title: "Order processing",
    category: "orders",
    description:
      "Validates an order, charges the customer, pauses on a durable sleep, then waits for payment confirmation before shipping.",
    signals: [
      {
        id: "paymentConfirmed",
        title: "Payment confirmed",
        description: "Sent by the payment provider once the charge settles.",
        presets: [
          { name: "Card settled", payload: { transactionId: "txn_demo_123" } },
        ],
      },
    ],
    presets: [
      {
        name: "Standard order",
        payload: { orderId: "ORD-42", customerId: "CUST-7", amount: 99.99 },
      },
      {
        name: "Invalid order (rejected)",
        payload: { orderId: "", customerId: "CUST-7", amount: -5 },
      },
    ],
    graph: {
      nodes: [
        {
          id: "validateOrder",
          kind: "step",
          label: "Validate order",
          description: "Checks the order input is well-formed.",
        },
        {
          id: "chargeCustomer",
          kind: "step",
          label: "Charge customer",
          description: "Simulates a payment gateway charge.",
        },
        {
          id: "__sleep:processingDelay",
          kind: "sleep",
          label: "Processing delay",
          description: "Durable sleep — survives restarts.",
        },
        {
          id: "__signal:awaitPaymentConfirmation",
          kind: "signal",
          label: "Await payment",
          description: "Suspends until the PaymentConfirmed signal arrives.",
          signal: "paymentConfirmed",
        },
        {
          id: "shipOrder",
          kind: "step",
          label: "Ship order",
          description: "Marks the order as shipped.",
        },
      ],
      edges: [
        { from: "validateOrder", to: "chargeCustomer" },
        { from: "chargeCustomer", to: "__sleep:processingDelay" },
        {
          from: "__sleep:processingDelay",
          to: "__signal:awaitPaymentConfirmation",
        },
        { from: "__signal:awaitPaymentConfirmation", to: "shipOrder" },
      ],
    },
  },
  {
    key: "userOnboarding",
    title: "User onboarding",
    category: "growth",
    description:
      "Provisions an account, sends a verification email, then branches on signal-vs-timeout with a replay-safe switch.",
    signals: [
      {
        id: "emailVerified",
        title: "Email verified",
        description: "Sent when the user clicks the verification link.",
        presets: [
          { name: "User clicked link", payload: { verifiedAt: 1_786_000_000_000 } },
        ],
      },
    ],
    presets: [
      {
        name: "Pro trial",
        payload: { email: "ada@example.com", plan: "pro" },
      },
      {
        name: "Free plan, quick timeout",
        payload: {
          email: "grace@example.com",
          plan: "free",
          verificationTimeoutMs: 4000,
        },
      },
    ],
    graph: {
      nodes: [
        {
          id: "createAccount",
          kind: "step",
          label: "Create account",
          description: "Provisions the user record.",
        },
        {
          id: "sendVerificationEmail",
          kind: "step",
          label: "Send verification email",
          description: "Sends the click-to-verify email.",
        },
        {
          id: "__signal:awaitEmailVerification",
          kind: "signal",
          label: "Await verification",
          description:
            "Suspends until EmailVerified arrives or the timeout elapses.",
          signal: "emailVerified",
        },
        {
          id: "provisionBranch",
          kind: "switch",
          label: "Verified?",
          description: "Replay-safe branch on the wait outcome.",
          branches: ["verified", "timed-out"],
        },
        {
          id: "provisionResources",
          kind: "step",
          label: "Provision workspace",
          description: "Sets up the workspace (verified path only).",
        },
        {
          id: "sendWelcomeEmail",
          kind: "step",
          label: "Send welcome email",
          description: "Sends the welcome message on every path.",
        },
      ],
      edges: [
        { from: "createAccount", to: "sendVerificationEmail" },
        {
          from: "sendVerificationEmail",
          to: "__signal:awaitEmailVerification",
        },
        { from: "__signal:awaitEmailVerification", to: "provisionBranch" },
        {
          from: "provisionBranch",
          to: "provisionResources",
          branch: "verified",
          label: "verified",
        },
        {
          from: "provisionBranch",
          to: "sendWelcomeEmail",
          branch: "timed-out",
          label: "timed out",
        },
        { from: "provisionResources", to: "sendWelcomeEmail" },
      ],
    },
  },
  {
    key: "incidentResponse",
    title: "Incident response",
    category: "reliability",
    description:
      "Pages on-call, waits for an ack, diagnoses, then gates automated remediation behind an approval decision.",
    signals: [
      {
        id: "incidentAcknowledged",
        title: "Incident acknowledged",
        description: "Sent when the on-call engineer acks the page.",
        presets: [
          {
            name: "On-call ack",
            payload: {
              acknowledgedBy: "ada@acme.dev",
              acknowledgedAt: 1_786_000_000_000,
            },
          },
        ],
      },
      {
        id: "approvalDecision",
        title: "Approval decision",
        description: "Change approval for automated remediation.",
        presets: [
          {
            name: "Approve",
            payload: { approved: true, decidedBy: "ops-lead@acme.dev" },
          },
          {
            name: "Reject",
            payload: {
              approved: false,
              decidedBy: "ops-lead@acme.dev",
              reason: "freeze window",
            },
          },
        ],
      },
    ],
    presets: [
      {
        name: "SEV-2 outage",
        payload: {
          incidentId: "INC-2077",
          severity: "SEV-2",
          summary: "Checkout latency above SLO",
        },
      },
      {
        name: "Chaos run (diagnose fails)",
        payload: {
          incidentId: "INC-CHAOS",
          severity: "SEV-1",
          summary: "Chaos drill",
          chaos: true,
        },
      },
    ],
    graph: {
      nodes: [
        {
          id: "triageAlert",
          kind: "step",
          label: "Triage alert",
          description: "Validates and records the incoming alert.",
        },
        {
          id: "pageOnCall",
          kind: "step",
          label: "Page on-call",
          description: "Pages via phone (SEV-1) or Slack.",
        },
        {
          id: "__signal:awaitAck",
          kind: "signal",
          label: "Await ack",
          description: "Suspends until on-call acks or the timeout elapses.",
          signal: "incidentAcknowledged",
        },
        {
          id: "ackBranch",
          kind: "switch",
          label: "Acked?",
          description: "Replay-safe branch on the ack outcome.",
          branches: ["acked", "timed-out"],
        },
        {
          id: "diagnose",
          kind: "step",
          label: "Diagnose",
          description: "Runs the runbook diagnosis (acked path).",
        },
        {
          id: "__signal:awaitApproval",
          kind: "signal",
          label: "Await approval",
          description:
            "Suspends until the approval decision or the timeout elapses.",
          signal: "approvalDecision",
        },
        {
          id: "approvalBranch",
          kind: "switch",
          label: "Approved?",
          description: "Replay-safe branch on the approval outcome.",
          branches: ["approved", "rejected"],
        },
        {
          id: "remediate",
          kind: "step",
          label: "Remediate",
          description: "Runs automated remediation (approved path).",
        },
        {
          id: "verifyRecovery",
          kind: "step",
          label: "Verify recovery",
          description: "Health-checks the system after remediation.",
        },
        {
          id: "escalate",
          kind: "step",
          label: "Escalate",
          description: "Escalates to the incident commander (timeout path).",
        },
        {
          id: "closeIncident",
          kind: "step",
          label: "Close incident",
          description: "Records the outcome on every path.",
        },
      ],
      edges: [
        { from: "triageAlert", to: "pageOnCall" },
        { from: "pageOnCall", to: "__signal:awaitAck" },
        { from: "__signal:awaitAck", to: "ackBranch" },
        { from: "ackBranch", to: "diagnose", branch: "acked", label: "acked" },
        {
          from: "ackBranch",
          to: "escalate",
          branch: "timed-out",
          label: "timed out",
        },
        { from: "diagnose", to: "__signal:awaitApproval" },
        { from: "__signal:awaitApproval", to: "approvalBranch" },
        {
          from: "approvalBranch",
          to: "remediate",
          branch: "approved",
          label: "approved",
        },
        {
          from: "approvalBranch",
          to: "closeIncident",
          branch: "rejected",
          label: "rejected",
        },
        { from: "remediate", to: "verifyRecovery" },
        { from: "verifyRecovery", to: "closeIncident" },
        { from: "escalate", to: "closeIncident" },
      ],
    },
  },
  ...OPERATIONS_WORKFLOWS,
];

export const DEMO_WORKFLOWS = buildScaleWorkflows(CORE_DEMO_WORKFLOWS);
