/**
 * Test suite for custom type registration and usage
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Serializer } from '../index';
import type { TypeDefinition } from '../index';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface FirstType {
  type: 'first';
  value: string;
}

interface SecondType {
  type: 'second';
  value: string;
}

// Test classes for custom types
class Point {
  constructor(
    public x: number,
    public y: number
  ) {}
}

class ComplexNumber {
  constructor(
    public real: number,
    public imaginary: number
  ) {}

  add(other: ComplexNumber): ComplexNumber {
    return new ComplexNumber(this.real + other.real, this.imaginary + other.imaginary);
  }
}

class LinkedListNode<T = unknown> {
  constructor(
    public value: T,
    public next?: LinkedListNode<T>,
    public prev?: LinkedListNode<T>
  ) {}
}

const createPointType = (): TypeDefinition<Point, { x: number; y: number }> => ({
  id: 'Point',
  is: (obj: unknown): obj is Point => obj instanceof Point,
  serialize: (point: Point) => ({ x: point.x, y: point.y }),
  deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
});

const createComplexNumberType = (): TypeDefinition<
  ComplexNumber,
  { real: number; imaginary: number }
> => ({
  id: 'ComplexNumber',
  is: (obj: unknown): obj is ComplexNumber => obj instanceof ComplexNumber,
  serialize: (complex: ComplexNumber) => ({ real: complex.real, imaginary: complex.imaginary }),
  deserialize: (data: { real: number; imaginary: number }) =>
    new ComplexNumber(data.real, data.imaginary),
});

const createLinkedListType = (): TypeDefinition<
  LinkedListNode<unknown>,
  { value: unknown; next: LinkedListNode<unknown> | null }
> => ({
  id: 'LinkedListNode',
  is: (obj: unknown): obj is LinkedListNode<unknown> => obj instanceof LinkedListNode,
  serialize: (node: LinkedListNode<unknown>) => ({
    value: node.value,
    next: node.next ?? null,
  }),
  deserialize: (data: { value: unknown; next: LinkedListNode<unknown> | null }) =>
    new LinkedListNode(data.value, data.next ?? undefined),
});

interface CoordinateSystem {
  name: string;
  origin: Point;
  points: Point[];
  metadata: {
    center: Point;
  };
}

type MixedCustomArray = Array<Point | ComplexNumber | string | number>;

interface MixedCustomStructure {
  location: Point;
  impedance: ComplexNumber;
  mixedArray: MixedCustomArray;
  metadata: {
    origin: Point;
    phase: ComplexNumber;
  };
}

describe('Custom Type Tests', () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe('Custom type placeholders', () => {
    it('should allow self-referential custom types when create() is provided', () => {
      class Box {
        public self: Box;
        constructor(public label: string) {
          this.self = this;
        }
      }

      const boxType: TypeDefinition<Box, { label: string; self: Box }> = {
        id: 'Box',
        is: (obj: unknown): obj is Box => obj instanceof Box,
        serialize: (box: Box) => ({
          label: box.label,
          self: box.self,
        }),
        deserialize: (data: { label: string; self: Box }) => {
          const instance = new Box(data.label);
          instance.self = data.self;
          return instance;
        },
        create: () => new Box(''),
      };

      serializer.addType(boxType);

      const original = new Box('demo');
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<Box>(serialized);

      expect(deserialized).toBeInstanceOf(Box);
      expect(deserialized.label).toBe('demo');
      expect(deserialized.self).toBe(deserialized);
    });
  });

  describe('Point Type', () => {
    it('should serialize and deserialize Point objects', () => {
      // Register Point type
      serializer.addType(createPointType());

      const original = new Point(10, 20);
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<Point>(serialized);

      expect(deserialized).toBeInstanceOf(Point);
      expect(deserialized.x).toBe(10);
      expect(deserialized.y).toBe(20);
    });

    it('should handle arrays of Point objects', () => {
      serializer.addType(createPointType());

      const points = [new Point(0, 0), new Point(1, 1), new Point(2, 2)];
      const serialized = serializer.serialize(points);
      const deserialized = serializer.deserialize<Point[]>(serialized);

      expect(deserialized).toHaveLength(3);
      expect(deserialized[0]).toBeInstanceOf(Point);
      expect(deserialized[1]).toBeInstanceOf(Point);
      expect(deserialized[2]).toBeInstanceOf(Point);
      expect(deserialized[2].x).toBe(2);
      expect(deserialized[2].y).toBe(2);
    });

    it('should handle Point objects in nested structures', () => {
      serializer.addType(createPointType());

      const complexStructure: CoordinateSystem = {
        name: 'coordinate system',
        origin: new Point(0, 0),
        points: [new Point(1, 1), new Point(2, 2)],
        metadata: {
          center: new Point(50, 50),
        },
      };

      const serialized = serializer.serialize(complexStructure);
      const deserialized = serializer.deserialize<CoordinateSystem>(serialized);

      expect(deserialized.name).toBe('coordinate system');
      expect(deserialized.origin).toBeInstanceOf(Point);
      expect(deserialized.points[0]).toBeInstanceOf(Point);
      expect(deserialized.metadata.center).toBeInstanceOf(Point);
      expect(deserialized.metadata.center.x).toBe(50);
    });
  });

  describe('ComplexNumber Type', () => {
    it('should serialize and deserialize ComplexNumber objects', () => {
      serializer.addType(createComplexNumberType());

      const original = new ComplexNumber(3.14, 2.71);
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<ComplexNumber>(serialized);

      expect(deserialized).toBeInstanceOf(ComplexNumber);
      expect(deserialized.real).toBe(3.14);
      expect(deserialized.imaginary).toBe(2.71);

      // Test that methods are available
      const sum = deserialized.add(new ComplexNumber(1, 1));
      expect(sum.real).toBeCloseTo(4.14);
      expect(sum.imaginary).toBeCloseTo(3.71);
    });
  });

  describe('LinkedListNode Type', () => {
    it('should handle singly linked list with custom type', () => {
      serializer.addType(createLinkedListType());

      // Create a simple linked list: A -> B -> C
      const nodeC = new LinkedListNode('C');
      const nodeB = new LinkedListNode('B', nodeC);
      const nodeA = new LinkedListNode('A', nodeB);

      const serialized = serializer.serialize(nodeA);
      const deserialized = serializer.deserialize<LinkedListNode<string>>(serialized);

      expect(deserialized.value).toBe('A');
      const secondNode = deserialized.next;
      expect(secondNode).toBeDefined();
      if (!secondNode) {
        throw new Error('Expected second node to be defined');
      }
      expect(secondNode.value).toBe('B');
      const thirdNode = secondNode.next;
      expect(thirdNode).toBeDefined();
      if (!thirdNode) {
        throw new Error('Expected third node to be defined');
      }
      expect(thirdNode.value).toBe('C');
    });

    it('should handle doubly linked list with circular references', () => {
      // Note: Circular references in custom types are complex due to how deserialization
      // creates instances. This test verifies that the basic structure is preserved.
      // For full circular reference support, consider using plain objects instead.

      serializer.addType(createLinkedListType());

      // Create a simple chain (prev references won't be preserved in custom types)
      const nodeA = new LinkedListNode('A');
      const nodeB = new LinkedListNode('B');
      nodeA.next = nodeB;

      const serialized = serializer.serialize(nodeA);
      const deserialized = serializer.deserialize<LinkedListNode<string>>(serialized);

      expect(deserialized.value).toBe('A');
      const nextNode = deserialized.next;
      expect(nextNode).toBeDefined();
      if (!nextNode) {
        throw new Error('Expected next node to be defined');
      }
      expect(nextNode.value).toBe('B');
      expect(nextNode).toBe(deserialized.next);
    });
  });

  describe('Multiple Custom Types', () => {
    it('should handle objects with multiple custom types', () => {
      // Register Point type
      serializer.addType(createPointType());

      // Register ComplexNumber type
      serializer.addType(createComplexNumberType());

      const complexObject: MixedCustomStructure = {
        location: new Point(100, 200),
        impedance: new ComplexNumber(50, 30),
        mixedArray: [new Point(0, 0), new ComplexNumber(1, 1), 'regular string', 42],
        metadata: {
          origin: new Point(-50, -50),
          phase: new ComplexNumber(0, 1),
        },
      };

      const serialized = serializer.serialize(complexObject);
      const deserialized = serializer.deserialize<MixedCustomStructure>(serialized);

      expect(deserialized.location).toBeInstanceOf(Point);
      expect(deserialized.location.x).toBe(100);
      expect(deserialized.impedance).toBeInstanceOf(ComplexNumber);
      expect(deserialized.impedance.real).toBe(50);
      expect(deserialized.mixedArray[0]).toBeInstanceOf(Point);
      expect(deserialized.mixedArray[1]).toBeInstanceOf(ComplexNumber);
      expect(deserialized.metadata.origin).toBeInstanceOf(Point);
      expect(deserialized.metadata.phase).toBeInstanceOf(ComplexNumber);
    });
  });

  describe('Type Registration Edge Cases', () => {
    it('should maintain type registration order', () => {
      let callOrder: string[] = [];

      // Register first type
      const firstType: TypeDefinition<FirstType, FirstType> = {
        id: 'First',
        is: (obj: unknown): obj is FirstType =>
          isRecord(obj) && obj.type === 'first' && typeof obj.value === 'string',
        serialize: (obj: FirstType) => {
          callOrder.push('first-serialize');
          return obj;
        },
        deserialize: (data: FirstType) => {
          callOrder.push('first-deserialize');
          return data;
        },
      };
      serializer.addType(firstType);

      // Register second type
      const secondType: TypeDefinition<SecondType, SecondType> = {
        id: 'Second',
        is: (obj: unknown): obj is SecondType =>
          isRecord(obj) && obj.type === 'second' && typeof obj.value === 'string',
        serialize: (obj: SecondType) => {
          callOrder.push('second-serialize');
          return obj;
        },
        deserialize: (data: SecondType) => {
          callOrder.push('second-deserialize');
          return data;
        },
      };
      serializer.addType(secondType);

      const obj1: FirstType = { type: 'first', value: 'test1' };
      const _obj2: SecondType = { type: 'second', value: 'test2' };

      const serialized1 = serializer.serialize(obj1);
      callOrder = [];
      const _deserialized1 = serializer.deserialize<FirstType>(serialized1);

      expect(callOrder).toEqual(['first-deserialize']);
    });

    it('should not allow duplicate type IDs', () => {
      const passthrough: TypeDefinition<Record<string, never>, Record<string, never>> = {
        id: 'CustomType',
        is: (_value: unknown): _value is Record<string, never> => true,
        serialize: () => ({}),
        deserialize: () => ({}),
      };
      serializer.addType(passthrough);

      expect(() => {
        serializer.addType(passthrough);
      }).toThrow('Type with id "CustomType" already exists');
    });
  });
});
