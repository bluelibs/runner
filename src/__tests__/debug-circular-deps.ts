import { IDependentNode } from "../tools/findCircularDependencies";

export function debugFindCircularDependencies(nodes: IDependentNode[]) {
  const result = {
    cycles: [] as string[],
    missingDependencies: [] as Array<{ nodeId: string; dependencyId: string }>,
  };
  const visited: Set<string> = new Set();
  const stack: Set<string> = new Set();
  const path: string[] = [];

  function dfs(node: IDependentNode): void {
    console.log(`\nVisiting node: ${node.id}`);
    console.log(`Current path: ${path.join(' -> ')}`);
    console.log(`Stack: [${Array.from(stack).join(', ')}]`);
    console.log(`Visited: [${Array.from(visited).join(', ')}]`);

    if (stack.has(node.id)) {
      console.log(`🔄 CYCLE DETECTED! ${node.id} is already in stack`);
      const cycleStartIndex = path.indexOf(node.id);
      const cycle = path.slice(cycleStartIndex).concat(node.id).join(" -> ");
      console.log(`Cycle: ${cycle}`);
      result.cycles.push(cycle);
      return;
    }

    if (visited.has(node.id)) {
      console.log(`⏭️  Node ${node.id} already visited, skipping`);
      return;
    }

    visited.add(node.id);
    stack.add(node.id);
    path.push(node.id);

    if (node.dependencies && typeof node.dependencies === "object") {
      const deps = Object.entries(node.dependencies);
      console.log(`Dependencies of ${node.id}: [${deps.map(([k, v]) => `${k}: ${v?.id || 'null'}`).join(', ')}]`);
      
      for (const [depKey, dependentNode] of deps) {
        if (!dependentNode) {
          console.log(`❌ Missing dependency: ${depKey}`);
          result.missingDependencies.push({
            nodeId: node.id,
            dependencyId: depKey,
          });
          continue;
        }
        console.log(`➡️  Following dependency: ${depKey} -> ${dependentNode.id}`);
        dfs(dependentNode);
      }
    } else {
      console.log(`❌ Invalid dependencies for ${node.id}`);
      result.missingDependencies.push({
        nodeId: node.id,
        dependencyId: "unknown",
      });
    }

    console.log(`⬅️  Backtracking from ${node.id}`);
    stack.delete(node.id);
    path.pop();
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      console.log(`\n🚀 Starting DFS from root: ${node.id}`);
      dfs(node);
    }
  }

  result.cycles = Array.from(new Set(result.cycles)); // Remove duplicate cycles
  console.log(`\n📊 Final results:`);
  console.log(`Cycles found: ${result.cycles.length}`);
  console.log(`Missing dependencies: ${result.missingDependencies.length}`);
  return result;
}