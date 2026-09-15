import type { StudioWorkflow } from "../shared/types.js";

const REGIONS = ["eu", "us", "apac"] as const;

function portfolioGraph(): StudioWorkflow["graph"] {
  const childNodes = REGIONS.flatMap((region) => [
    {
      id: `spawn:${region}`,
      kind: "child" as const,
      label: `Start ${region.toUpperCase()}`,
      description: `Starts the ${region.toUpperCase()} regional rollup child.`,
    },
    {
      id: `join:${region}`,
      kind: "child" as const,
      label: `Join ${region.toUpperCase()}`,
      description: `Waits for the ${region.toUpperCase()} child result.`,
    },
  ]);
  const orderedIds = [
    "planPortfolio",
    ...REGIONS.map((region) => `spawn:${region}`),
    ...REGIONS.map((region) => `join:${region}`),
    "publishPortfolio",
  ];
  return {
    nodes: [
      {
        id: "planPortfolio",
        kind: "step",
        label: "Plan portfolio",
        description: "Builds the regional fan-out plan.",
      },
      ...childNodes.sort(
        (left, right) => orderedIds.indexOf(left.id) - orderedIds.indexOf(right.id),
      ),
      {
        id: "publishPortfolio",
        kind: "step",
        label: "Publish rollup",
        description: "Combines every child result into the portfolio total.",
      },
    ],
    edges: orderedIds.slice(1).map((id, index) => ({
      from: orderedIds[index]!,
      to: id,
    })),
  };
}

export const OPERATIONS_WORKFLOWS: StudioWorkflow[] = [
  {
    key: "portfolioReconciliation",
    title: "Portfolio reconciliation",
    category: "operations",
    description:
      "Fans out three regional child workflows, waits for each result, and publishes one rollup.",
    signals: [],
    presets: [
      {
        name: "Quarter close",
        payload: { portfolioId: "PORT-Q3", ordersPerBatch: 120 },
      },
    ],
    graph: portfolioGraph(),
  },
  {
    key: "regionalRollup",
    title: "Regional rollup",
    category: "operations",
    description:
      "Processes a bounded three-iteration batch loop; usually started as a portfolio child.",
    signals: [],
    presets: [
      {
        name: "EU three-batch loop",
        payload: { region: "eu", batches: 3, ordersPerBatch: 120 },
      },
    ],
    graph: {
      nodes: [1, 2, 3].map((batch) => ({
        id: `processBatch:${batch}`,
        kind: "step" as const,
        label: `Process batch ${batch}`,
        description: `Loop iteration ${batch} of 3.`,
      })),
      edges: [
        { from: "processBatch:1", to: "processBatch:2", label: "next" },
        { from: "processBatch:2", to: "processBatch:3", label: "next" },
      ],
    },
  },
];
