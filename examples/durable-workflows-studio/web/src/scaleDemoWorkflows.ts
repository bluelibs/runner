import type { StudioWorkflow } from "../../src/shared/types.js";

const SCALE_WORKFLOW_COUNT = 50;

const SCALE_WORKFLOW_NAMES = [
  "Invoice settlement",
  "Subscription renewal",
  "Payment reconciliation",
  "Refund processing",
  "Revenue recognition",
  "Lead qualification",
  "Contract approval",
  "Account provisioning",
  "Customer migration",
  "Renewal outreach",
  "Inventory replenishment",
  "Shipment tracking",
  "Warehouse transfer",
  "Return authorization",
  "Supplier onboarding",
  "Identity verification",
  "Access certification",
  "Credential rotation",
  "Policy attestation",
  "Security remediation",
  "Data ingestion",
  "Dataset validation",
  "Report generation",
  "Retention enforcement",
  "Export fulfillment",
  "Environment deployment",
  "Release promotion",
  "Canary analysis",
  "Rollback coordination",
  "Dependency upgrade",
  "Claim adjudication",
  "Patient intake",
  "Lab result delivery",
  "Benefits verification",
  "Provider enrollment",
  "Content moderation",
  "Campaign activation",
  "Creative approval",
  "Audience synchronization",
  "Notification delivery",
  "Fraud investigation",
  "Risk assessment",
  "Compliance review",
  "Dispute resolution",
  "Case escalation",
] as const;

function workflowKey(title: string): string {
  const words = title.split(" ");
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : `${word[0]?.toUpperCase()}${word.slice(1).toLowerCase()}`,
    )
    .join("");
}

function categoryFor(index: number): string {
  return [
    "finance",
    "customer",
    "supply-chain",
    "security",
    "data",
    "delivery",
    "healthcare",
    "engagement",
    "risk",
  ][Math.floor(index / 5)]!;
}

function scaleWorkflow(title: string, index: number): StudioWorkflow {
  const key = workflowKey(title);
  return {
    key,
    title,
    category: categoryFor(index),
    description: `Production-shaped ${title.toLowerCase()} flow used to exercise the studio at fleet scale.`,
    signals: [],
    presets: [
      {
        name: "Sample request",
        payload: { referenceId: `${key.toUpperCase()}-42`, priority: "normal" },
      },
    ],
    graph: {
      nodes: [
        {
          id: "validateRequest",
          kind: "step",
          label: "Validate request",
          description: "Validates the incoming request and required policy.",
        },
        {
          id: "performWork",
          kind: "step",
          label: "Perform work",
          description: "Runs the durable business operation.",
        },
        {
          id: "publishOutcome",
          kind: "step",
          label: "Publish outcome",
          description: "Records and publishes the final result.",
        },
      ],
      edges: [
        { from: "validateRequest", to: "performWork" },
        { from: "performWork", to: "publishOutcome" },
      ],
    },
  };
}

/** Expands the hand-authored workflows into the 50-type operator demo catalog. */
export function buildScaleWorkflows(
  coreWorkflows: StudioWorkflow[],
): StudioWorkflow[] {
  const workflows = [
    ...coreWorkflows,
    ...SCALE_WORKFLOW_NAMES.map(scaleWorkflow),
  ];
  if (workflows.length !== SCALE_WORKFLOW_COUNT) {
    throw new Error(
      `Scale demo must contain ${SCALE_WORKFLOW_COUNT} workflow types; received ${workflows.length}.`,
    );
  }
  return workflows;
}
