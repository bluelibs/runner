export interface MatchSchemaOptions {
  exact?: boolean;
  schemaId?: string;
}

export type MatchClassOptions = MatchSchemaOptions;

interface ClassSchemaMetadata {
  fields: Map<string, unknown>;
  options: MatchSchemaOptions;
}

type ClassConstructor = abstract new (...args: never[]) => unknown;

const CLASS_SCHEMA_METADATA = new WeakMap<Function, ClassSchemaMetadata>();

function ensureMetadata(target: Function): ClassSchemaMetadata {
  const existing = CLASS_SCHEMA_METADATA.get(target);
  if (existing) return existing;

  const created: ClassSchemaMetadata = {
    fields: new Map<string, unknown>(),
    options: {},
  };
  CLASS_SCHEMA_METADATA.set(target, created);
  return created;
}

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

export function setClassSchemaOptions(
  target: ClassConstructor,
  options: MatchSchemaOptions,
): void {
  const metadata = ensureMetadata(target as unknown as Function);
  metadata.options = {
    ...metadata.options,
    ...options,
  };
}

export function setClassFieldPattern(
  target: ClassConstructor,
  propertyKey: string,
  pattern: unknown,
): void {
  const metadata = ensureMetadata(target as unknown as Function);
  metadata.fields.set(propertyKey, pattern);
}

export function getClassSchemaDefinition(target: ClassConstructor): {
  pattern: Record<string, unknown>;
  exact: boolean;
  schemaId: string;
} {
  const fields: Record<string, unknown> = {};
  let exact = false;
  let schemaId = target.name || "Anonymous";

  for (const ctor of getClassChain(target as unknown as Function)) {
    const metadata = CLASS_SCHEMA_METADATA.get(ctor);
    if (!metadata) continue;

    for (const [key, pattern] of metadata.fields.entries()) {
      fields[key] = pattern;
    }

    if (metadata.options.exact !== undefined) {
      exact = metadata.options.exact;
    }

    if (metadata.options.schemaId && metadata.options.schemaId.length > 0) {
      schemaId = metadata.options.schemaId;
    }
  }

  return {
    pattern: fields,
    exact,
    schemaId,
  };
}

export function hasClassSchemaMetadata(target: ClassConstructor): boolean {
  for (const ctor of getClassChain(target as unknown as Function)) {
    if (CLASS_SCHEMA_METADATA.has(ctor)) {
      return true;
    }
  }

  return false;
}
