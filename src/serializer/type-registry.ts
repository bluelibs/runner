/**
 * Type registry for managing custom serialization types.
 * Extracted from Serializer.ts as a standalone module.
 */

import { symbolPolicyError, typeRegistryError } from "./errors";
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
  ): void {
    if (!typeDef || !typeDef.id) {
      throw typeRegistryError("Invalid type definition: id is required");
    }
    if (typeof typeDef.is !== "function") {
      throw typeRegistryError("Invalid type definition: is is required");
    }
    if (!typeDef.serialize || !typeDef.deserialize) {
      throw typeRegistryError(
        "Invalid type definition: serialize and deserialize are required",
      );
    }
    if (this.typeRegistry.has(typeDef.id)) {
      throw typeRegistryError(`Type with id "${typeDef.id}" already exists`);
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
      throw typeRegistryError(`Type "${typeId}" is not allowed`);
    }
    const typeDef = this.typeMap.get(typeId);
    if (!typeDef) {
      throw typeRegistryError(`Unknown type: ${typeId}`);
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
      throw symbolPolicyError(SymbolPolicyErrorMessage.UnsupportedSymbolPolicy);
    }
  }

  private assertSymbolPolicy(payload: SerializedSymbolPayload): void {
    switch (this.symbolPolicy) {
      case SymbolPolicy.AllowAll:
        return;
      case SymbolPolicy.WellKnownOnly:
        if (payload.kind === SymbolPayloadKind.For) {
          throw symbolPolicyError(
            SymbolPolicyErrorMessage.GlobalSymbolsNotAllowed,
          );
        }
        return;
      case SymbolPolicy.Disabled:
        throw symbolPolicyError(SymbolPolicyErrorMessage.SymbolsNotAllowed);
    }
  }
}
