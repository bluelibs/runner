import { MatchPatternError } from "./errors";
import { isClassConstructor, getClassChain } from "../typeChecks";

type ClassConstructor = abstract new (...args: never[]) => unknown;

type ClassSchemaBaseResolver = () => ClassConstructor;

export type MatchSchemaBase = ClassConstructor | ClassSchemaBaseResolver;

export interface MatchSchemaOptions {
  exact?: boolean;
  schemaId?: string;
  base?: MatchSchemaBase;
}

export type MatchClassOptions = MatchSchemaOptions;

interface ClassSchemaMetadata {
  fields: Map<string, unknown>;
  options: MatchSchemaOptions;
}

interface ClassSchemaDefinition {
  pattern: Record<string, unknown>;
  exact: boolean;
  schemaId: string;
}

interface CachedClassSchemaDefinition {
  version: number;
  definition: ClassSchemaDefinition;
}

const CLASS_SCHEMA_METADATA = new WeakMap<Function, ClassSchemaMetadata>();
const CLASS_SCHEMA_DEFINITION_CACHE = new WeakMap<
  Function,
  CachedClassSchemaDefinition
>();
let classSchemaMetadataVersion = 0;

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

function bumpSchemaMetadataVersion(): void {
  classSchemaMetadataVersion += 1;
}

function resolveSchemaBase(
  baseOption: MatchSchemaBase,
  owner: Function,
): ClassConstructor {
  if (isClassConstructor(baseOption)) {
    return baseOption;
  }

  const resolved = baseOption();
  if (!isClassConstructor(resolved)) {
    throw new MatchPatternError(
      `Bad pattern: Match.Schema({ base }) for ${owner.name || "Anonymous"} must resolve to a class constructor.`,
    );
  }

  return resolved;
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
  bumpSchemaMetadataVersion();
}

export function setClassFieldPattern(
  target: ClassConstructor,
  propertyKey: string,
  pattern: unknown,
): void {
  const metadata = ensureMetadata(target as unknown as Function);
  metadata.fields.set(propertyKey, pattern);
  bumpSchemaMetadataVersion();
}

function buildClassSchemaDefinition(
  target: ClassConstructor,
  activeTargets: Set<Function>,
): ClassSchemaDefinition {
  if (activeTargets.has(target as unknown as Function)) {
    throw new MatchPatternError(
      `Bad pattern: Match.Schema({ base }) contains a circular base chain at ${target.name || "Anonymous"}.`,
    );
  }

  activeTargets.add(target as unknown as Function);

  const fields: Record<string, unknown> = {};
  let exact = false;
  let schemaId = target.name || "Anonymous";

  try {
    for (const ctor of getClassChain(target as unknown as Function)) {
      const metadata = CLASS_SCHEMA_METADATA.get(ctor);
      if (!metadata) continue;

      if (metadata.options.base) {
        const baseConstructor = resolveSchemaBase(metadata.options.base, ctor);
        const baseDefinition = buildClassSchemaDefinition(
          baseConstructor,
          activeTargets,
        );

        Object.assign(fields, baseDefinition.pattern);
        exact = baseDefinition.exact;
        schemaId = baseDefinition.schemaId;
      }

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

    return Object.freeze({
      pattern: Object.freeze({ ...fields }),
      exact,
      schemaId,
    });
  } finally {
    activeTargets.delete(target as unknown as Function);
  }
}

export function getClassSchemaDefinition(
  target: ClassConstructor,
): ClassSchemaDefinition {
  const cached = CLASS_SCHEMA_DEFINITION_CACHE.get(
    target as unknown as Function,
  );
  if (cached && cached.version === classSchemaMetadataVersion) {
    return cached.definition;
  }

  const definition = buildClassSchemaDefinition(target, new Set<Function>());
  CLASS_SCHEMA_DEFINITION_CACHE.set(target as unknown as Function, {
    version: classSchemaMetadataVersion,
    definition,
  });

  return definition;
}

export function hasClassSchemaMetadata(target: ClassConstructor): boolean {
  for (const ctor of getClassChain(target as unknown as Function)) {
    if (CLASS_SCHEMA_METADATA.has(ctor)) {
      return true;
    }
  }

  return false;
}
