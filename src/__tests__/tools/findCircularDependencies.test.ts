import {
  findCircularDependencies,
  IDependentNode,
} from "../../tools/findCircularDependencies";

describe("checkCircularDependencies", () => {
  test("should detect a simple cycle (A -> B -> C -> A)", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;
    nodeC.dependencies["A"] = nodeA;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual(["A -> B -> C -> A"]);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should detect multiple cycles", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;
    nodeC.dependencies["A"] = nodeA; // Cycle: A -> B -> C -> A
    nodeC.dependencies["D"] = nodeD;
    nodeD.dependencies["B"] = nodeB; // Cycle: B -> C -> D -> B

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD];
    const result = findCircularDependencies(nodes);

    // The order of cycles in the result array might vary
    expect(result.cycles).toContain("A -> B -> C -> A");
    expect(result.cycles).toContain("B -> C -> D -> B");
    expect(result.cycles.length).toBe(2);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should return empty arrays when there are no cycles", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual([]);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should detect a self-referential cycle (A -> A)", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    nodeA.dependencies["A"] = nodeA; // Cycle: A -> A

    const nodes: IDependentNode[] = [nodeA];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual(["A -> A"]);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should handle complex graphs with shared nodes", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };
    const nodeE: IDependentNode = { id: "E", dependencies: {} };

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;
    nodeC.dependencies["D"] = nodeD;
    nodeD.dependencies["B"] = nodeB; // Cycle: B -> C -> D -> B
    nodeC.dependencies["E"] = nodeE;
    nodeE.dependencies["C"] = nodeC; // Cycle: C -> E -> C

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD, nodeE];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toContain("B -> C -> D -> B");
    expect(result.cycles).toContain("C -> E -> C");
    expect(result.cycles.length).toBe(2);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should handle multiple independent cycles", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };
    const nodeE: IDependentNode = { id: "E", dependencies: {} };
    const nodeF: IDependentNode = { id: "F", dependencies: {} };

    // Cycle 1: A -> B -> A
    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["A"] = nodeA;

    // Cycle 2: C -> D -> E -> C
    nodeC.dependencies["D"] = nodeD;
    nodeD.dependencies["E"] = nodeE;
    nodeE.dependencies["C"] = nodeC;

    // Cycle 3: F -> F
    nodeF.dependencies["F"] = nodeF;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD, nodeE, nodeF];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toContain("A -> B -> A");
    expect(result.cycles).toContain("C -> D -> E -> C");
    expect(result.cycles).toContain("F -> F");
    expect(result.cycles.length).toBe(3);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should handle disconnected graphs", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };

    // Cycle 1: A -> B -> A
    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["A"] = nodeA;

    // Cycle 2: C -> D -> C
    nodeC.dependencies["D"] = nodeD;
    nodeD.dependencies["C"] = nodeC;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toContain("A -> B -> A");
    expect(result.cycles).toContain("C -> D -> C");
    expect(result.cycles.length).toBe(2);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should handle nodes with no dependencies", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };

    const nodes: IDependentNode[] = [nodeA, nodeB];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual([]);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should handle dependencies that do not form cycles", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;
    nodeC.dependencies["D"] = nodeD;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual([]);
    expect(result.missingDependencies).toEqual([]);
  });

  test("should report missing dependencies", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    // nodeB is missing
    nodeA.dependencies["B"] = undefined as any; // Force undefined dependency

    const nodes: IDependentNode[] = [nodeA];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toEqual([]);
    expect(result.missingDependencies).toEqual([
      { nodeId: "A", dependencyId: "B" },
    ]);
  });

  test("should handle complex graph with multiple overlapping cycles", () => {
    const nodeA: IDependentNode = { id: "A", dependencies: {} };
    const nodeB: IDependentNode = { id: "B", dependencies: {} };
    const nodeC: IDependentNode = { id: "C", dependencies: {} };
    const nodeD: IDependentNode = { id: "D", dependencies: {} };
    const nodeE: IDependentNode = { id: "E", dependencies: {} };
    const nodeF: IDependentNode = { id: "F", dependencies: {} };

    // Construct cycles:
    // A -> B -> C -> A
    // C -> D -> E -> F -> C

    nodeA.dependencies["B"] = nodeB;
    nodeB.dependencies["C"] = nodeC;
    nodeC.dependencies["A"] = nodeA;
    nodeC.dependencies["D"] = nodeD;
    nodeD.dependencies["E"] = nodeE;
    nodeE.dependencies["F"] = nodeF;
    nodeF.dependencies["C"] = nodeC;

    const nodes: IDependentNode[] = [nodeA, nodeB, nodeC, nodeD, nodeE, nodeF];
    const result = findCircularDependencies(nodes);

    expect(result.cycles).toContain("A -> B -> C -> A");
    expect(result.cycles).toContain("C -> D -> E -> F -> C");
    expect(result.cycles.length).toBe(2);
    expect(result.missingDependencies).toEqual([]);
  });
});
