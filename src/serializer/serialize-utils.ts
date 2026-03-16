import { genericError } from "../errors";
import type { TypeDefinition } from "./types";
import type { SerializedValue } from "./types";
import type { TypeRegistry } from "./type-registry";
import { isUnsafeKey } from "./validation";

export const serializeArrayItems = <TSerializedValue>(
  source: readonly unknown[],
  serializeNested: (value: unknown) => TSerializedValue,
): TSerializedValue[] => {
  const length = source.length;
  const items: TSerializedValue[] = new Array(length);
  for (let index = 0; index < length; index += 1) {
    items[index] = serializeNested(source[index]);
  }
  return items;
};

export const serializeRecordEntries = <TSerializedValue>(
  source: Record<string, unknown>,
  unsafeKeys: ReadonlySet<string>,
  serializeNested: (value: unknown) => TSerializedValue,
  mapKey: (key: string) => string = (key) => key,
): Record<string, TSerializedValue> => {
  const record: Record<string, TSerializedValue> = {};
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    if (isUnsafeKey(key, unsafeKeys)) {
      continue;
    }
    const outputKey = mapKey(key);
    record[outputKey] = serializeNested(source[key]);
  }
  return record;
};

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
