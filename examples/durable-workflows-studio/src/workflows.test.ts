import test from "node:test";
import assert from "node:assert/strict";
import { getWorkflow, SIGNALS, WORKFLOWS } from "./workflows/catalog.js";
import { SIGNALS_BY_ID, TASKS_BY_KEY } from "./server/studioApp.js";
import type { StudioWorkflow } from "./shared/types.js";

/**
 * Guards the core studio contract: catalog keys match runnable tasks, graphs
 * are well-formed, and persisted step ids line up with the engine's
 * `__sleep:` / `__signal:` namespacing.
 */
test("catalog workflows match runnable tasks", () => {
  assert.deepEqual(
    WORKFLOWS.map((workflow) => workflow.key).sort(),
    Object.keys(TASKS_BY_KEY).sort(),
  );
  for (const workflow of WORKFLOWS) {
    assert.equal(getWorkflow(workflow.key)?.title, workflow.title);
    assert.ok(workflow.presets.length > 0, `${workflow.key} needs presets`);
    for (const preset of workflow.presets) {
      assert.ok(preset.name.length > 0);
      JSON.stringify(preset.payload);
    }
  }
  assert.equal(getWorkflow("nope"), undefined);
});

test("catalog signals match deliverable definitions", () => {
  assert.deepEqual(
    Object.keys(SIGNALS).sort(),
    Object.keys(SIGNALS_BY_ID).sort(),
  );
  for (const signal of Object.values(SIGNALS)) {
    assert.ok(signal.title.length > 0);
    assert.ok(signal.presets.length > 0, `${signal.id} needs presets`);
  }
});

function assertWellFormedGraph(workflow: StudioWorkflow): void {
  const nodeIds = new Set(workflow.graph.nodes.map((node) => node.id));
  assert.ok(nodeIds.size === workflow.graph.nodes.length, "unique node ids");
  assert.ok(nodeIds.size > 0, "non-empty graph");

  for (const edge of workflow.graph.edges) {
    assert.ok(nodeIds.has(edge.from), `edge from unknown ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `edge to unknown ${edge.to}`);
    assert.notEqual(edge.from, edge.to, "no self edges");
  }

  const incoming = new Map<string, number>();
  for (const id of nodeIds) incoming.set(id, 0);
  for (const edge of workflow.graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const roots = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  assert.equal(roots.length, 1, "exactly one root node");

  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of workflow.graph.edges) {
      if (edge.from === id) queue.push(edge.to);
    }
  }
  assert.deepEqual(
    [...reachable].sort(),
    [...nodeIds].sort(),
    "every node reachable from the root",
  );
}

function assertBranchContract(workflow: StudioWorkflow): void {
  const byId = new Map(workflow.graph.nodes.map((node) => [node.id, node]));
  for (const node of workflow.graph.nodes) {
    if (node.kind !== "switch") continue;
    assert.ok(
      (node.branches?.length ?? 0) >= 2,
      `${node.id} declares at least two branches`,
    );
    const branchEdges = workflow.graph.edges.filter(
      (edge) => edge.from === node.id,
    );
    assert.ok(branchEdges.length >= 2, `${node.id} fans out`);
    for (const edge of branchEdges) {
      assert.ok(
        node.branches?.includes(edge.branch ?? ""),
        `${node.id}→${edge.to} uses a declared branch`,
      );
    }
  }
  for (const edge of workflow.graph.edges) {
    if (edge.branch === undefined) continue;
    const from = byId.get(edge.from);
    assert.equal(from?.kind, "switch", "branch edges leave switch nodes");
  }
}

function assertStepIdContract(workflow: StudioWorkflow): void {
  for (const node of workflow.graph.nodes) {
    if (node.kind === "signal") {
      assert.ok(
        node.id.startsWith("__signal:"),
        `${node.id} uses the engine signal namespace`,
      );
      assert.ok(node.signal, `${node.id} names its signal`);
      assert.ok(
        SIGNALS[node.signal!] !== undefined,
        `${node.id} references a known signal`,
      );
    }
    if (node.kind === "sleep") {
      assert.ok(
        node.id.startsWith("__sleep:"),
        `${node.id} uses the engine sleep namespace`,
      );
    }
    if (node.kind === "step" || node.kind === "switch") {
      assert.ok(
        !node.id.startsWith("__"),
        `${node.id} keeps its declared step id`,
      );
    }
  }
}

for (const workflow of WORKFLOWS) {
  test(`graph integrity: ${workflow.key}`, () => {
    assertWellFormedGraph(workflow);
    assertBranchContract(workflow);
    assertStepIdContract(workflow);
  });
}

test("every workflow signal has a matching graph node", () => {
  for (const workflow of WORKFLOWS) {
    const nodeSignals = new Set(
      workflow.graph.nodes
        .filter((node) => node.kind === "signal")
        .map((node) => node.signal),
    );
    for (const signal of workflow.signals) {
      assert.ok(
        nodeSignals.has(signal.id),
        `${workflow.key} visualises ${signal.id}`,
      );
    }
  }
});
