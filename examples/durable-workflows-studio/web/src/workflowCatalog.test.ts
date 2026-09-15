import { describe, expect, it } from "vitest";
import type { StudioWorkflow } from "../../src/shared/types.js";
import { filterWorkflows } from "./workflowCatalog.js";

const workflows: StudioWorkflow[] = [
  {
    key: "invoice-sync",
    title: "Invoice synchronization",
    category: "finance",
    description: "Reconciles invoices with the ledger.",
    signals: [],
    presets: [],
    graph: { nodes: [], edges: [] },
  },
  {
    key: "user-onboarding",
    title: "User onboarding",
    category: "growth",
    description: "Creates a new workspace.",
    signals: [],
    presets: [],
    graph: { nodes: [], edges: [] },
  },
];

describe("workflow catalog search", () => {
  it("searches titles, keys, categories and descriptions", () => {
    expect(filterWorkflows(workflows, "finance").map((item) => item.key))
      .toEqual(["invoice-sync"]);
    expect(filterWorkflows(workflows, "workspace").map((item) => item.key))
      .toEqual(["user-onboarding"]);
    expect(filterWorkflows(workflows, "INVOICE-SYNC").map((item) => item.key))
      .toEqual(["invoice-sync"]);
  });
});
