/**
 * A node that has dependencies.
 */
export interface IDependentNode {
  id: string;
  dependencies: Record<string, IDependentNode>;
}

interface FindCircularDependenciesResult {
  cycles: string[];
  missingDependencies: Array<{ nodeId: string; dependencyId: string }>;
}

export function findCircularDependencies(
  nodes: IDependentNode[],
): FindCircularDependenciesResult {
  const result: FindCircularDependenciesResult = {
    cycles: [],
    missingDependencies: [],
  };
  const visited: Set<string> = new Set();
  const stack: Set<string> = new Set();
  const path: string[] = [];

  function dfs(node: IDependentNode): void {
    if (stack.has(node.id)) {
      const cycleStartIndex = path.indexOf(node.id);
      const cycle = path.slice(cycleStartIndex).concat(node.id).join(" -> ");
      result.cycles.push(cycle);
      return;
    }

    if (visited.has(node.id)) return;

    visited.add(node.id);
    stack.add(node.id);
    path.push(node.id);

    for (const [depKey, dependentNode] of Object.entries(node.dependencies)) {
      if (!dependentNode) {
        result.missingDependencies.push({
          nodeId: node.id,
          dependencyId: depKey,
        });
        continue;
      }
      dfs(dependentNode);
    }

    stack.delete(node.id);
    path.pop();
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node);
    }
  }

  result.cycles = Array.from(new Set(result.cycles)); // Remove duplicate cycles
  return result;
}
