/**
 * Comprehensive test suite for the Serializer class
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Serializer } from '../index';
import type { TypeDefinition } from '../index';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface NamedSelf {
  name: string;
  self?: NamedSelf;
}

interface FriendNode {
  name: string;
  friends: FriendNode[];
}

interface ReferenceNode {
  id: number;
  parent?: ReferenceNode;
  referenced?: ReferenceNode;
}

type SelfReferentialMap = Map<string, SelfReferentialMap>;

interface Product {
  name: string;
  price: number;
}

interface Address {
  street: string;
  city: string;
}

type PrimitiveMixedArray = Array<number | string | boolean | null>;

interface SimpleObjectSample {
  name: string;
  age: number;
  active: boolean;
  tags: string[];
  metadata: null;
}

interface MixedTypeStructure {
  date: Date;
  regex: RegExp;
  map: Map<string, string>;
  user: User;
  nested: {
    array: number[];
    object: { inner: string };
  };
}

interface NullableExample {
  defined: string;
  undefined?: undefined;
  null: null;
}

const createUserType = (): TypeDefinition<User, { name: string; age: number }> => ({
  id: 'User',
  is: (obj: unknown): obj is User => obj instanceof User,
  serialize: (user: User) => ({ name: user.name, age: user.age }),
  deserialize: (data: { name: string; age: number }) => new User(data.name, data.age),
});

const createProductType = (): TypeDefinition<Product, Product> => ({
  id: 'Product',
  is: (obj: unknown): obj is Product =>
    isRecord(obj) && typeof obj.name === 'string' && typeof obj.price === 'number',
  serialize: (product: Product) => ({ name: product.name, price: product.price }),
  deserialize: (data: Product) => ({ name: data.name, price: data.price }),
});

const createAddressType = (): TypeDefinition<Address, Address> => ({
  id: 'Address',
  is: (obj: unknown): obj is Address =>
    isRecord(obj) && typeof obj.street === 'string' && typeof obj.city === 'string',
  serialize: (address: Address) => ({ street: address.street, city: address.city }),
  deserialize: (data: Address) => ({ street: data.street, city: data.city }),
});

// Test user-defined class for custom type testing
class User {
  constructor(
    public name: string,
    public age: number
  ) {}
}

describe('Serializer', () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe('Reference Preservation', () => {
    it('should preserve shared Map instances across the graph', () => {
      const shared = new Map([['count', 1]]);
      const original = { a: shared, b: shared };

      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<{
        a: Map<string, number>;
        b: Map<string, number>;
      }>(serialized);

      expect(deserialized.a).toBe(deserialized.b);
      expect(deserialized.a.get('count')).toBe(1);
    });

    it('should handle self-referential Map structures', () => {
      const original: SelfReferentialMap = new Map();
      original.set('self', original);

      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<SelfReferentialMap>(serialized);

      expect(deserialized).toBeInstanceOf(Map);
      expect(deserialized.get('self')).toBe(deserialized);
    });
  });

  describe('Basic Serialization', () => {
    it('should serialize and deserialize primitive values', () => {
      const testCases = [
        { value: null, expected: null },
        { value: undefined, expected: null }, // JSON.stringify converts undefined to null
        { value: true, expected: true },
        { value: false, expected: false },
        { value: 0, expected: 0 },
        { value: 42, expected: 42 },
        { value: 'hello', expected: 'hello' },
        { value: '', expected: '' },
        // Note: JSON converts NaN and Infinity to null during serialization
        { value: NaN, expected: null },
        { value: Infinity, expected: null },
      ];

      testCases.forEach(({ value, expected }) => {
        const serialized = serializer.serialize(value);
        const deserialized = serializer.deserialize<typeof expected>(serialized);
        expect(deserialized).toBe(expected);
      });
    });

    it('should serialize and deserialize arrays', () => {
      const original: PrimitiveMixedArray = [1, 2, 3, 'hello', true, null];
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<PrimitiveMixedArray>(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should serialize and deserialize plain objects', () => {
      const original: SimpleObjectSample = {
        name: 'John',
        age: 30,
        active: true,
        tags: ['developer', 'javascript'],
        metadata: null,
      };

      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<SimpleObjectSample>(serialized);

      expect(deserialized).toEqual(original);
    });
  });

  describe('Built-in Type Support', () => {
    it('should handle Date objects', () => {
      const original = new Date('2024-01-01T12:00:00.000Z');
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<Date>(serialized);

      expect(deserialized).toBeInstanceOf(Date);
      expect(deserialized.getTime()).toBe(original.getTime());
    });

    it('should handle RegExp objects', () => {
      const original = /test/gi;
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<RegExp>(serialized);

      expect(deserialized).toBeInstanceOf(RegExp);
      expect(deserialized.source).toBe(original.source);
      expect(deserialized.flags).toBe(original.flags);
    });

    it('should handle Map objects', () => {
      const original = new Map<string | number, string | number | Record<string, string>>([
        ['key1', 'value1'],
        ['key2', 42],
        [123, { nested: 'object' }],
      ]);

      const serialized = serializer.serialize(original);
      const deserialized =
        serializer.deserialize<Map<string | number, string | number | Record<string, string>>>(
          serialized
        );

      expect(deserialized).toBeInstanceOf(Map);
      expect(deserialized.size).toBe(original.size);
      expect(deserialized.get('key1')).toBe('value1');
      expect(deserialized.get('key2')).toBe(42);
      expect(deserialized.get(123)).toEqual({ nested: 'object' });
    });

    it('should handle Set objects', () => {
      type SetValue = number | { nested: boolean };
      const original = new Set<SetValue>([1, 2, 3, { nested: true }]);
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<Set<SetValue>>(serialized);

      expect(deserialized).toBeInstanceOf(Set);
      expect(deserialized.size).toBe(original.size);
      expect(deserialized.has(1)).toBe(true);
      expect(deserialized.has(3)).toBe(true);
    });
  });

  describe('Circular Reference Support', () => {
    it('should handle simple circular references', () => {
      const obj: NamedSelf = { name: 'test' };
      obj.self = obj;

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<NamedSelf>(serialized);

      expect(deserialized.name).toBe('test');
      expect(deserialized.self).toBe(deserialized);
    });

    it('should handle complex circular references', () => {
      const user1: FriendNode = { name: 'Alice', friends: [] };
      const user2: FriendNode = { name: 'Bob', friends: [] };

      user1.friends.push(user2);
      user2.friends.push(user1);

      const serialized = serializer.serialize(user1);
      const deserialized = serializer.deserialize<FriendNode>(serialized);

      expect(deserialized.name).toBe('Alice');
      expect(deserialized.friends[0].name).toBe('Bob');
      expect(deserialized.friends[0].friends[0]).toBe(deserialized);
    });

    it('should handle deeply nested circular references', () => {
      const obj1: ReferenceNode = { id: 1 };
      const obj2: ReferenceNode = { id: 2, parent: obj1 };
      const obj3: ReferenceNode = { id: 3, parent: obj2 };
      const obj4: ReferenceNode = { id: 4, parent: obj3 };

      // Create circular reference from deepest to shallowest
      obj1.referenced = obj4;

      const serialized = serializer.serialize(obj1);
      const deserialized = serializer.deserialize<ReferenceNode>(serialized);

      expect(deserialized.id).toBe(1);
      const referenced = deserialized.referenced;
      expect(referenced).toBeDefined();
      if (!referenced) {
        throw new Error('Expected referenced node to be defined');
      }
      expect(referenced.id).toBe(4);
      const parent = referenced.parent;
      expect(parent).toBeDefined();
      if (!parent) {
        throw new Error('Expected parent node to be defined');
      }
      expect(parent.id).toBe(3);
      const grandParent = parent.parent;
      expect(grandParent).toBeDefined();
      if (!grandParent) {
        throw new Error('Expected grandparent node to be defined');
      }
      expect(grandParent.id).toBe(2);
      expect(grandParent.parent).toBe(deserialized);
    });
  });

  describe('Custom Type Registration', () => {
    it('should allow registering custom types', () => {
      // Register User type
      serializer.addType(createUserType());

      const original = new User('Alice', 30);
      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<User>(serialized);

      expect(deserialized).toBeInstanceOf(User);
      expect(deserialized.name).toBe('Alice');
      expect(deserialized.age).toBe(30);
    });

    it('should throw error when registering duplicate type', () => {
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

    it('should handle multiple custom types', () => {
      // Register User type
      serializer.addType(createUserType());

      // Register Product type
      serializer.addType(createProductType());

      // Register Address type
      serializer.addType(createAddressType());

      const complexObject: {
        user: User;
        product: Product;
        address: Address;
      } = {
        user: new User('John', 25),
        product: { name: 'Widget', price: 99.99 },
        address: { street: '123 Main St', city: 'Anytown' },
      };

      const serialized = serializer.serialize(complexObject);
      const deserialized = serializer.deserialize<typeof complexObject>(serialized);

      expect(deserialized.user).toBeInstanceOf(User);
      expect(deserialized.product.price).toBe(99.99);
      expect(deserialized.address.city).toBe('Anytown');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty objects and arrays', () => {
      const testCases = [{}, [], '', 0, false, null];

      testCases.forEach((value) => {
        const serialized = serializer.serialize(value);
        const deserialized = serializer.deserialize(serialized);
        expect(deserialized).toEqual(value);
      });
    });

    it('should handle nested objects with mixed types', () => {
      // Register User type
      serializer.addType(createUserType());

      const original: MixedTypeStructure = {
        date: new Date('2024-01-01'),
        regex: /test/gi,
        map: new Map([['key', 'value']]),
        user: new User('Test', 25),
        nested: {
          array: [1, 2, 3],
          object: { inner: 'value' },
        },
      };

      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<MixedTypeStructure>(serialized);

      expect(deserialized.date).toBeInstanceOf(Date);
      expect(deserialized.regex).toBeInstanceOf(RegExp);
      expect(deserialized.map).toBeInstanceOf(Map);
      expect(deserialized.user).toBeInstanceOf(User);
      expect(deserialized.nested.array).toEqual([1, 2, 3]);
      expect(deserialized.nested.object.inner).toBe('value');
    });

    it('should handle objects with undefined values', () => {
      const original: NullableExample = {
        defined: 'value',
        undefined: undefined,
        null: null,
      };

      const serialized = serializer.serialize(original);
      const deserialized = serializer.deserialize<NullableExample>(serialized);

      expect(deserialized.defined).toBe('value');
      expect(deserialized.null).toBe(null);
      // Note: JSON.stringify removes undefined values
      expect(Object.prototype.hasOwnProperty.call(deserialized, 'undefined')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unknown types during deserialization', () => {
      const serialized = JSON.stringify({
        __type: 'UnknownType',
        value: 'some data',
      });

      expect(() => {
        serializer.deserialize(serialized);
      }).toThrow('Unknown type: UnknownType');
    });
  });
});
