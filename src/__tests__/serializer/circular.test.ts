/**
 * Test suite specifically for circular reference handling
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

interface SelfReferential {
  id: number;
  self?: SelfReferential;
}

type RecursiveNumberArray = Array<number | RecursiveNumberArray>;

interface MutualNode {
  id: number;
  other?: MutualNode;
}

interface ChainNode {
  id: number;
  next?: ChainNode;
}

interface GraphNode {
  id: number;
  connections: GraphNode[];
}

interface DeepNode {
  id: number;
  next?: DeepNode;
  prev?: DeepNode;
  first?: DeepNode;
}

interface MixedChild {
  id: number;
  regex: RegExp;
  array: number[];
  parent?: MixedParent;
}

interface MixedParent {
  id: number;
  date: Date;
  map: Map<string, string>;
  nested: MixedChild;
}

describe("Circular Reference Tests", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Simple Circular References", () => {
    it("should handle self-reference in object", () => {
      const obj: SelfReferential = { id: 1 };
      obj.self = obj;

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<SelfReferential>(serialized);

      expect(deserialized.id).toBe(1);
      expect(deserialized.self).toBe(deserialized);
    });

    it("should handle self-reference in array", () => {
      const arr: RecursiveNumberArray = [1, 2, 3];
      arr.push(arr);

      const serialized = serializer.serialize(arr);
      const deserialized =
        serializer.deserialize<RecursiveNumberArray>(serialized);

      expect(deserialized[0]).toBe(1);
      expect(deserialized[1]).toBe(2);
      expect(deserialized[2]).toBe(3);
      expect(deserialized[3]).toBe(deserialized);
    });
  });

  describe("Mutual Circular References", () => {
    it("should handle two objects referencing each other", () => {
      const obj1: MutualNode = { id: 1 };
      const obj2: MutualNode = { id: 2 };

      obj1.other = obj2;
      obj2.other = obj1;

      const serialized = serializer.serialize(obj1);
      const deserialized = serializer.deserialize<MutualNode>(serialized);

      expect(deserialized.id).toBe(1);
      const other = deserialized.other;
      expect(other).toBeDefined();
      if (!other) {
        throw new Error("Expected other node to be defined");
      }
      expect(other.id).toBe(2);
      expect(other.other).toBe(deserialized);
    });

    it("should handle three objects in circular chain", () => {
      const obj1: ChainNode = { id: 1 };
      const obj2: ChainNode = { id: 2 };
      const obj3: ChainNode = { id: 3 };

      obj1.next = obj2;
      obj2.next = obj3;
      obj3.next = obj1;

      const serialized = serializer.serialize(obj1);
      const deserialized = serializer.deserialize<ChainNode>(serialized);

      expect(deserialized.id).toBe(1);
      const secondNode = deserialized.next;
      expect(secondNode).toBeDefined();
      if (!secondNode) {
        throw new Error("Expected second node to be defined");
      }
      expect(secondNode.id).toBe(2);
      const thirdNode = secondNode.next;
      expect(thirdNode).toBeDefined();
      if (!thirdNode) {
        throw new Error("Expected third node to be defined");
      }
      expect(thirdNode.id).toBe(3);
      expect(thirdNode.next).toBe(deserialized);
    });
  });

  describe("Complex Circular Structures", () => {
    it("should handle tree with parent references", () => {
      interface TreeNode {
        id: number;
        children: TreeNode[];
        parent?: TreeNode;
      }

      const root: TreeNode = { id: 1, children: [], parent: undefined };
      const child1: TreeNode = { id: 2, children: [], parent: undefined };
      const child2: TreeNode = { id: 3, children: [], parent: undefined };

      // Build tree structure
      root.children.push(child1);
      root.children.push(child2);
      child1.parent = root;
      child2.parent = root;

      const serialized = serializer.serialize(root);
      const deserialized = serializer.deserialize<TreeNode>(serialized);

      expect(deserialized.id).toBe(1);
      expect(deserialized.children.length).toBe(2);
      expect(deserialized.children[0].parent).toBe(deserialized);
      expect(deserialized.children[1].parent).toBe(deserialized);
    });

    it("should handle graph with multiple circular paths", () => {
      const node1: GraphNode = { id: 1, connections: [] };
      const node2: GraphNode = { id: 2, connections: [] };
      const node3: GraphNode = { id: 3, connections: [] };

      // Create complex circular graph
      node1.connections.push(node2);
      node1.connections.push(node3);
      node2.connections.push(node1);
      node3.connections.push(node2);
      node3.connections.push(node1);

      const serialized = serializer.serialize(node1);
      const deserialized = serializer.deserialize<GraphNode>(serialized);

      expect(deserialized.id).toBe(1);
      expect(deserialized.connections.length).toBe(2);
      expect(deserialized.connections[0].id).toBe(2);
      expect(deserialized.connections[1].id).toBe(3);
      expect(deserialized.connections[0].connections[0]).toBe(deserialized);
    });
  });

  describe("Performance with Deep Circularity", () => {
    it("should handle deeply nested circular references", () => {
      // Create a deeply nested structure
      const head: DeepNode = { id: 0 };
      let current: DeepNode = head;

      // Build a chain of 100 objects
      for (let i = 1; i < 100; i++) {
        const next: DeepNode = { id: i, prev: current };
        current.next = next;
        current = next;
      }

      // Create circular reference from last to first
      current.first = head;

      const serialized = serializer.serialize(current);
      const deserialized = serializer.deserialize<DeepNode>(serialized);

      // Verify the structure is maintained
      expect(deserialized.id).toBe(99);
      const previousNode = deserialized.prev;
      expect(previousNode).toBeDefined();
      if (!previousNode) {
        throw new Error("Expected previous node to be defined");
      }
      expect(previousNode.id).toBe(98);
    });
  });

  describe("Mixed Circular and Built-in Types", () => {
    it("should handle circular references with built-in types", () => {
      const obj2: MixedChild = {
        id: 2,
        regex: /test/gi,
        array: [1, 2, 3],
      };

      const obj1: MixedParent = {
        id: 1,
        date: new Date("2024-01-01"),
        map: new Map([["key", "value"]]),
        nested: obj2,
      };

      obj2.parent = obj1;

      const serialized = serializer.serialize(obj1);
      const deserialized = serializer.deserialize<MixedParent>(serialized);

      expect(deserialized.id).toBe(1);
      expect(deserialized.date).toBeInstanceOf(Date);
      expect(deserialized.map).toBeInstanceOf(Map);
      expect(deserialized.nested.id).toBe(2);
      expect(deserialized.nested.parent).toBe(deserialized);
      expect(deserialized.nested.regex).toBeInstanceOf(RegExp);
    });
  });
});
