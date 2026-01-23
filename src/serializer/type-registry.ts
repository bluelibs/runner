/**
 * Type registry for managing custom serialization types.
 * Extracted from Serializer.ts as a standalone module.
 */

import type { TypeDefinition } from "./types";
import { SymbolPolicy, SymbolPolicyErrorMessage } from "./types";
import {
  assertSymbolPayload,
  builtInTypes,
  SymbolPayloadKind,
  type SerializedSymbolPayload,
} from "./builtins";
import {
  assertRegExpPayload,
  type RegExpValidatorOptions,
} from "./regexp-validator";
import { SpecialTypeId } from "./special-values";

export interface TypeRegistryOptions {
  allowedTypes: ReadonlySet<string> | null;
  regExpValidator: RegExpValidatorOptions;
  symbolPolicy: SymbolPolicy;
}

/**
 * Registry for managing custom type definitions.
 */
export class TypeRegistry {
  private readonly typeRegistry = new Map<
    string,
    TypeDefinition<unknown, unknown>
  >();
  private readonly typeMap = new Map<
    string,
    TypeDefinition<unknown, unknown>
  >();
  private typeList: TypeDefinition<unknown, unknown>[] = [];

  private readonly allowedTypes: ReadonlySet<string> | null;
  private readonly regExpOptions: RegExpValidatorOptions;
  private readonly symbolPolicy: SymbolPolicy;

  constructor(options: TypeRegistryOptions) {
    this.allowedTypes = options.allowedTypes;
    this.regExpOptions = options.regExpValidator;
    this.symbolPolicy = options.symbolPolicy;
    this.assertSymbolPolicyValue(this.symbolPolicy);
    this.registerBuiltInTypes();
    this.refreshTypeCache();
  }

  /**
   * Get the list of registered types for iteration.
   */
  getTypeList(): readonly TypeDefinition<unknown, unknown>[] {
    return this.typeList;
  }

  /**
   * @internal - Map-like get() for test compatibility.
   */
  get(typeId: string): TypeDefinition<unknown, unknown> | undefined {
    return this.typeMap.get(typeId);
  }

  /**
   * Register a custom type definition.
   */
  addType<TInstance, TSerialized>(
    typeDef: TypeDefinition<TInstance, TSerialized>,
  ): void;
  addType<TJson = unknown, TInstance = unknown>(
    name: string,
    factory: (json: TJson) => TInstance,
  ): void;
  addType<TInstance, TSerialized>(
    arg1: string | TypeDefinition<TInstance, TSerialized>,
    arg2?: (json: unknown) => unknown,
  ): void {
    if (typeof arg1 === "string") {
      const name = arg1;
      const factory = arg2;
      if (!factory) {
        throw new Error(`addType("${name}", factory) requires a factory`);
      }

      type ValueTypeInstance = { typeName(): string; toJSONValue(): unknown };
      const isValueTypeInstance = (obj: unknown): obj is ValueTypeInstance => {
        if (!obj || typeof obj !== "object") return false;
        const rec = obj as Record<string, unknown>;
        return (
          typeof rec.typeName === "function" &&
          typeof rec.toJSONValue === "function"
        );
      };

      this.addType({
        id: name,
        is: (obj: unknown): obj is ValueTypeInstance =>
          isValueTypeInstance(obj) && obj.typeName() === name,
        serialize: (obj: ValueTypeInstance) => obj.toJSONValue(),
        deserialize: (data: unknown) => factory(data) as ValueTypeInstance,
        strategy: "value",
      });
      return;
    }

    const typeDef = arg1;
    if (!typeDef || !typeDef.id) {
      throw new Error("Invalid type definition: id is required");
    }
    if (!typeDef.serialize || !typeDef.deserialize) {
      throw new Error(
        "Invalid type definition: serialize and deserialize are required",
      );
    }
    if (this.typeRegistry.has(typeDef.id)) {
      throw new Error(`Type with id "${typeDef.id}" already exists`);
    }

    this.typeRegistry.set(
      typeDef.id,
      typeDef as TypeDefinition<unknown, unknown>,
    );
    this.refreshTypeCache();
  }

  /**
   * Find a type definition that matches the given value.
   */
  findTypeDefinition(
    value: unknown,
    excludedTypeIds: readonly string[],
  ): TypeDefinition<unknown, unknown> | undefined {
    for (const typeDef of this.typeList) {
      if (excludedTypeIds.includes(typeDef.id)) {
        continue;
      }
      try {
        if (typeDef.is(value)) {
          return typeDef;
        }
      } catch {
        // Type guard threw an error; skip this type definition
        continue;
      }
    }
    return undefined;
  }

  /**
   * Get a type definition by ID with allowed types enforcement.
   */
  getTypeDefinition(typeId: string): TypeDefinition<unknown, unknown> {
    if (this.allowedTypes && !this.allowedTypes.has(typeId)) {
      throw new Error(`Type "${typeId}" is not allowed`);
    }
    const typeDef = this.typeMap.get(typeId);
    if (!typeDef) {
      throw new Error(`Unknown type: ${typeId}`);
    }
    return typeDef;
  }

  /**
   * Deserialize typed data with special handling for RegExp.
   */
  deserializeType(
    typeDef: TypeDefinition<unknown, unknown>,
    typeId: string,
    data: unknown,
  ): unknown {
    if (typeId === SpecialTypeId.Symbol) {
      const payload = assertSymbolPayload(data);
      this.assertSymbolPolicy(payload);
      return typeDef.deserialize(payload);
    }
    if (typeId === "RegExp") {
      const payload = assertRegExpPayload(data, this.regExpOptions);
      return typeDef.deserialize(payload);
    }
    return typeDef.deserialize(data);
  }

  /**
   * Check if a type's serialized payload matches the type itself.
   * Used to prevent recursive type application.
   */
  shouldExcludeTypeFromPayload(
    typeDef: TypeDefinition<unknown, unknown>,
    serializedPayload: unknown,
  ): boolean {
    try {
      return typeDef.is(serializedPayload);
    } catch {
      return false;
    }
  }

  private registerBuiltInTypes(): void {
    for (const typeDef of builtInTypes) {
      this.typeRegistry.set(typeDef.id, typeDef);
    }
  }

  private refreshTypeCache(): void {
    this.typeMap.clear();
    const list: TypeDefinition<unknown, unknown>[] = [];
    for (const typeDef of this.typeRegistry.values()) {
      this.typeMap.set(typeDef.id, typeDef);
      list.push(typeDef);
    }
    this.typeList = list;
  }

  private assertSymbolPolicyValue(policy: SymbolPolicy): void {
    if (!Object.values(SymbolPolicy).includes(policy)) {
      throw new Error(SymbolPolicyErrorMessage.UnsupportedSymbolPolicy);
    }
  }

  private assertSymbolPolicy(payload: SerializedSymbolPayload): void {
    switch (this.symbolPolicy) {
      case SymbolPolicy.AllowAll:
        return;
      case SymbolPolicy.WellKnownOnly:
        if (payload.kind === SymbolPayloadKind.For) {
          throw new Error(SymbolPolicyErrorMessage.GlobalSymbolsNotAllowed);
        }
        return;
      case SymbolPolicy.Disabled:
        throw new Error(SymbolPolicyErrorMessage.SymbolsNotAllowed);
    }
  }
}
