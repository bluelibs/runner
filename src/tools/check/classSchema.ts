import { createMatchPatternError } from "./errors";
import { getDecoratorMetadataRecord } from "../../decorators/metadata";
import { isClassConstructor, getClassChain } from "../typeChecks";
import type { MatchPattern } from "./types";

type ClassConstructor = abstract new (...args: never[]) => unknown;

type ClassSchemaBaseResolver = () => ClassConstructor;

export type MatchSchemaBase = ClassConstructor | ClassSchemaBaseResolver;

export interface MatchSchemaOptions {
  exact?: boolean;
  schemaId?: string;
  base?: MatchSchemaBase;
  errorPolicy?: "first" | "all";
  /** @deprecated Use errorPolicy instead. */
  throwAllErrors?: boolean;
}

export type MatchClassOptions = MatchSchemaOptions;

interface ClassSchemaMetadata {
  fields: Map<string, MatchPattern>;
  options: MatchSchemaOptions;
}

export interface ClassSchemaDefinition {
  pattern: Record<string, unknown>;
  exact: boolean;
  schemaId: string;
  errorPolicy: "first" | "all";
}

interface CachedClassSchemaDefinition {
  version: number;
  definition: ClassSchemaDefinition;
}

const CLASS_SCHEMA_METADATA = new WeakMap<Function, ClassSchemaMetadata>();
// Use the global registry so decorator writers/readers keep the same key even
// when consumers mix top-level and subpath entrypoints in one process.
const CLASS_SCHEMA_ES_METADATA = Symbol.for(
  "@bluelibs/runner/check/class-schema-metadata",
);
const CLASS_SCHEMA_DEFINITION_CACHE = new WeakMap<
  Function,
  CachedClassSchemaDefinition
>();
let classSchemaMetadataVersion = 0;

function ensureMetadata(target: Function): ClassSchemaMetadata {
  const existing = CLASS_SCHEMA_METADATA.get(target);
  if (existing) return existing;

  const created: ClassSchemaMetadata = {
    fields: new Map<string, MatchPattern>(),
    options: {},
  };
  CLASS_SCHEMA_METADATA.set(target, created);
  return created;
}

function ensureEsMetadata(
  metadata: Record<PropertyKey, unknown>,
): ClassSchemaMetadata {
  const existing = metadata[CLASS_SCHEMA_ES_METADATA];
  if (existing !== undefined) {
    return existing as ClassSchemaMetadata;
  }

  const created: ClassSchemaMetadata = {
    fields: new Map<string, MatchPattern>(),
    options: {},
  };
  metadata[CLASS_SCHEMA_ES_METADATA] = created;
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
    throw createMatchPatternError(
      `Bad pattern: Match.Schema({ base }) for ${owner.name || "Anonymous"} must resolve to a class constructor.`,
    );
  }

  return resolved;
}

// Abstract constructors don't extend Function in TypeScript's type system,
// yet all constructors ARE functions at runtime. This helper bridges the gap.
function ctorAsFunction(target: ClassConstructor): Function {
  return target as unknown as Function;
}

export function setLegacyClassSchemaOptions(
  target: ClassConstructor,
  options: MatchSchemaOptions,
): void {
  const metadata = ensureMetadata(ctorAsFunction(target));
  metadata.options = {
    ...metadata.options,
    ...options,
  };
  bumpSchemaMetadataVersion();
}

export function setClassFieldPattern(
  target: ClassConstructor,
  propertyKey: string,
  pattern: MatchPattern,
): void {
  const metadata = ensureMetadata(ctorAsFunction(target));
  metadata.fields.set(propertyKey, pattern);
  bumpSchemaMetadataVersion();
}

export function setEsClassSchemaOptions(
  metadataRecord: Record<PropertyKey, unknown>,
  options: MatchSchemaOptions,
): void {
  const metadata = ensureEsMetadata(metadataRecord);
  metadata.options = {
    ...metadata.options,
    ...options,
  };
}

export function setEsClassFieldPattern(
  metadataRecord: Record<PropertyKey, unknown>,
  propertyKey: string,
  pattern: MatchPattern,
): void {
  const metadata = ensureEsMetadata(metadataRecord);
  metadata.fields.set(propertyKey, pattern);
}

export function setLegacyClassFieldPattern(
  target: ClassConstructor,
  propertyKey: string,
  pattern: MatchPattern,
): void {
  const metadata = ensureMetadata(ctorAsFunction(target));
  metadata.fields.set(propertyKey, pattern);
  bumpSchemaMetadataVersion();
}

function getCombinedClassSchemaMetadata(
  target: Function,
): ClassSchemaMetadata | undefined {
  const legacyMetadata = CLASS_SCHEMA_METADATA.get(target);
  const metadataRecord = getDecoratorMetadataRecord(target);
  const esMetadata = metadataRecord?.[CLASS_SCHEMA_ES_METADATA] as
    | ClassSchemaMetadata
    | undefined;

  if (!legacyMetadata) {
    return esMetadata;
  }

  if (!esMetadata) {
    return legacyMetadata;
  }

  // Merge both stores so a class chain can mix legacy- and ES-decorated types
  // without forcing the rest of the validation pipeline to care.
  return {
    fields: new Map<string, MatchPattern>([
      ...legacyMetadata.fields.entries(),
      ...esMetadata.fields.entries(),
    ]),
    options: {
      ...legacyMetadata.options,
      ...esMetadata.options,
    },
  };
}

function buildClassSchemaDefinition(
  target: ClassConstructor,
  activeTargets: Set<Function>,
): ClassSchemaDefinition {
  const fn = ctorAsFunction(target);
  if (activeTargets.has(fn)) {
    throw createMatchPatternError(
      `Bad pattern: Match.Schema({ base }) contains a circular base chain at ${target.name || "Anonymous"}.`,
    );
  }

  activeTargets.add(fn);

  const fields: Record<string, unknown> = {};
  let exact = false;
  let schemaId = target.name || "Anonymous";
  let errorPolicy: "first" | "all" = "first";

  try {
    for (const ctor of getClassChain(fn)) {
      const metadata = getCombinedClassSchemaMetadata(ctor);
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
        errorPolicy = baseDefinition.errorPolicy;
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

      if (metadata.options.errorPolicy !== undefined) {
        errorPolicy = metadata.options.errorPolicy;
      } else if (metadata.options.throwAllErrors !== undefined) {
        errorPolicy = metadata.options.throwAllErrors ? "all" : "first";
      }
    }

    return Object.freeze({
      pattern: Object.freeze({ ...fields }),
      exact,
      schemaId,
      errorPolicy,
    });
  } finally {
    activeTargets.delete(fn);
  }
}

export function getClassSchemaDefinition(
  target: ClassConstructor,
): ClassSchemaDefinition {
  const fn = ctorAsFunction(target);
  const cached = CLASS_SCHEMA_DEFINITION_CACHE.get(fn);
  if (cached && cached.version === classSchemaMetadataVersion) {
    return cached.definition;
  }

  const definition = buildClassSchemaDefinition(target, new Set<Function>());
  CLASS_SCHEMA_DEFINITION_CACHE.set(fn, {
    version: classSchemaMetadataVersion,
    definition,
  });

  return definition;
}

export function hasClassSchemaMetadata(target: ClassConstructor): boolean {
  for (const ctor of getClassChain(ctorAsFunction(target))) {
    if (getCombinedClassSchemaMetadata(ctor)) {
      return true;
    }
  }

  return false;
}
