import { validationError } from "./errors";
import type { SerializerFieldOptions } from "./types";

export type SerializerClassConstructor = abstract new (
  ...args: never[]
) => unknown;

type NormalizedSerializerFieldOptions = {
  from?: string;
  serialize?: (value: unknown) => unknown;
  deserialize?: (value: unknown) => unknown;
};

type SerializerFieldPlan = {
  byTargetKey: ReadonlyMap<string, NormalizedSerializerFieldOptions>;
  sourceToTargetKey: ReadonlyMap<string, string>;
  hasSerializeChanges: boolean;
  hasDeserializeChanges: boolean;
};

type CachedSerializerFieldPlan = {
  version: number;
  plan: SerializerFieldPlan;
};

const SERIALIZER_FIELD_METADATA = new WeakMap<
  Function,
  Map<string, NormalizedSerializerFieldOptions>
>();
const SERIALIZER_FIELD_PLAN_CACHE = new WeakMap<
  Function,
  CachedSerializerFieldPlan
>();

let serializerFieldMetadataVersion = 0;

function getClassChain(target: Function): Function[] {
  const chain: Function[] = [];
  let currentPrototype = target.prototype;

  while (currentPrototype && currentPrototype !== Object.prototype) {
    const constructor = currentPrototype.constructor as Function;
    if (typeof constructor !== "function") break;
    chain.push(constructor);
    currentPrototype = Object.getPrototypeOf(currentPrototype);
  }

  return chain.reverse();
}

function readFieldOptions(
  options: SerializerFieldOptions,
): NormalizedSerializerFieldOptions {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    validationError(
      "Invalid Serializer.Field() options: expected a plain object.",
    );
  }

  const from = options.from;
  if (from !== undefined) {
    if (typeof from !== "string" || from.length === 0) {
      validationError(
        'Invalid Serializer.Field() option "from": expected a non-empty string.',
      );
    }
  }

  const serialize = options.serialize;
  if (serialize !== undefined && typeof serialize !== "function") {
    validationError(
      'Invalid Serializer.Field() option "serialize": expected a function.',
    );
  }

  const deserialize = options.deserialize;
  if (deserialize !== undefined && typeof deserialize !== "function") {
    validationError(
      'Invalid Serializer.Field() option "deserialize": expected a function.',
    );
  }

  return {
    from,
    serialize,
    deserialize,
  };
}

function readOrCreateMetadata(
  target: Function,
): Map<string, NormalizedSerializerFieldOptions> {
  const existing = SERIALIZER_FIELD_METADATA.get(target);
  if (existing) return existing;

  const created = new Map<string, NormalizedSerializerFieldOptions>();
  SERIALIZER_FIELD_METADATA.set(target, created);
  return created;
}

export function setSerializerFieldOptions(
  target: SerializerClassConstructor,
  propertyKey: string,
  options: SerializerFieldOptions,
): void {
  const metadata = readOrCreateMetadata(target as unknown as Function);
  metadata.set(propertyKey, readFieldOptions(options));
  serializerFieldMetadataVersion += 1;
}

function compileSerializerFieldPlan(
  target: SerializerClassConstructor,
): SerializerFieldPlan {
  const byTargetKey = new Map<string, NormalizedSerializerFieldOptions>();

  for (const ctor of getClassChain(target as unknown as Function)) {
    const metadata = SERIALIZER_FIELD_METADATA.get(ctor);
    if (!metadata) continue;

    for (const [targetKey, options] of metadata.entries()) {
      byTargetKey.set(targetKey, options);
    }
  }

  const sourceToTargetKey = new Map<string, string>();
  let hasSerializeChanges = false;
  let hasDeserializeChanges = false;

  for (const [targetKey, options] of byTargetKey.entries()) {
    const sourceKey = options.from ?? targetKey;

    if (sourceKey !== targetKey || options.serialize !== undefined) {
      hasSerializeChanges = true;
    }

    if (sourceKey !== targetKey || options.deserialize !== undefined) {
      hasDeserializeChanges = true;
    }

    const existingTarget = sourceToTargetKey.get(sourceKey);
    if (existingTarget !== undefined && existingTarget !== targetKey) {
      validationError(
        `Invalid Serializer.Field() configuration: duplicate source key "${sourceKey}" mapped to "${existingTarget}" and "${targetKey}".`,
      );
    }

    sourceToTargetKey.set(sourceKey, targetKey);
  }

  return {
    byTargetKey,
    sourceToTargetKey,
    hasSerializeChanges,
    hasDeserializeChanges,
  };
}

function getSerializerFieldPlan(
  target: SerializerClassConstructor,
): SerializerFieldPlan {
  const constructor = target as unknown as Function;
  const cached = SERIALIZER_FIELD_PLAN_CACHE.get(constructor);

  if (cached && cached.version === serializerFieldMetadataVersion) {
    return cached.plan;
  }

  const plan = compileSerializerFieldPlan(target);
  SERIALIZER_FIELD_PLAN_CACHE.set(constructor, {
    version: serializerFieldMetadataVersion,
    plan,
  });
  return plan;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function remapValueForSchemaDeserialize(
  value: unknown,
  target: SerializerClassConstructor,
): unknown {
  const plan = getSerializerFieldPlan(target);
  if (!plan.hasDeserializeChanges) return value;
  if (!isPlainRecord(value)) return value;

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key in source) {
    const targetKey = plan.sourceToTargetKey.get(key) ?? key;

    if (
      targetKey !== key &&
      Object.prototype.hasOwnProperty.call(source, targetKey)
    ) {
      validationError(
        `Invalid serializer field mapping for "${target.name || "<anonymous>"}": both source key "${key}" and target key "${targetKey}" are present in payload.`,
      );
    }

    const fieldOptions = plan.byTargetKey.get(targetKey);
    const rawValue = source[key];
    const mappedValue =
      fieldOptions?.deserialize !== undefined
        ? fieldOptions.deserialize(rawValue)
        : rawValue;

    result[targetKey] = mappedValue;
  }

  return result;
}

export function remapObjectForSerialization(
  value: object,
): Record<string, unknown> {
  const constructor = (value as { constructor?: unknown }).constructor;
  if (typeof constructor !== "function") {
    return value as Record<string, unknown>;
  }

  const plan = getSerializerFieldPlan(
    constructor as SerializerClassConstructor,
  );
  if (!plan.hasSerializeChanges) {
    return value as Record<string, unknown>;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    const fieldOptions = plan.byTargetKey.get(key);
    const outputKey = fieldOptions?.from ?? key;
    const rawValue = source[key];
    const mappedValue =
      fieldOptions?.serialize !== undefined
        ? fieldOptions.serialize(rawValue)
        : rawValue;

    if (Object.prototype.hasOwnProperty.call(result, outputKey)) {
      validationError(
        `Invalid serializer field mapping for "${constructor.name || "<anonymous>"}": duplicate output key "${outputKey}" during serialization.`,
      );
    }

    result[outputKey] = mappedValue;
  }

  return result;
}
