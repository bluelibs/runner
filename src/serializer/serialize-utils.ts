import { genericError } from "../errors";
import type { TypeDefinition } from "./types";
import type { SerializedValue } from "./types";
import type { TypeRegistry } from "./type-registry";

export function serializeTypeRecord<TSerializedValue = SerializedValue>(
  typeDef: TypeDefinition<unknown, unknown>,
  value: unknown,
  excludedTypeIds: string[],
  serializeNested: (value: unknown) => TSerializedValue,
): { __type: string; value: TSerializedValue };

export function serializeTypeRecord<TSerializedValue = SerializedValue>(
  typeDef: TypeDefinition<unknown, unknown>,
  value: unknown,
  excludedTypeIds: string[],
  serializeNested: (value: unknown) => TSerializedValue,
): { __type: string; value: TSerializedValue } {
  excludedTypeIds.push(typeDef.id);
  try {
    const serializedPayload = typeDef.serialize(value);
    return {
      __type: typeDef.id,
      value: serializeNested(serializedPayload),
    };
  } finally {
    excludedTypeIds.pop();
  }
}

export function serializeSymbolValue<TSerializedValue = SerializedValue>(
  value: symbol,
  excludedTypeIds: string[],
  typeRegistry: TypeRegistry,
  serializeNested: (value: unknown) => TSerializedValue,
): { __type: string; value: TSerializedValue };

export function serializeSymbolValue<TSerializedValue = SerializedValue>(
  value: symbol,
  excludedTypeIds: string[],
  typeRegistry: TypeRegistry,
  serializeNested: (value: unknown) => TSerializedValue,
): { __type: string; value: TSerializedValue } {
  const typeDef = typeRegistry.findTypeDefinition(value, excludedTypeIds);
  if (!typeDef) {
    throw genericError.new({
      message: 'Cannot serialize value of type "symbol"',
    });
  }

  return serializeTypeRecord(typeDef, value, excludedTypeIds, serializeNested);
}
