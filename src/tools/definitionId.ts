import { validationError } from "../errors";

declare const definitionIdBrand: unique symbol;
declare const localIdBrand: unique symbol;
declare const canonicalIdBrand: unique symbol;
declare const sourceIdBrand: unique symbol;
declare const storageIdBrand: unique symbol;

type DefinitionId = string & { readonly [definitionIdBrand]: true };

/** An id captured at a definition or runtime-call source boundary. */
export type SourceId = DefinitionId & { readonly [sourceIdBrand]: true };

/** A single definition id segment owned by a resource. */
export type LocalId = SourceId & { readonly [localIdBrand]: true };

/** A definition id after ownership compilation. */
export type CanonicalId = DefinitionId & { readonly [canonicalIdBrand]: true };

/** A canonical id used as a key in stateful framework indexes. */
export type StorageId = CanonicalId & { readonly [storageIdBrand]: true };

function assertNonEmptyId(kind: string, id: string): void {
  if (id.trim().length > 0) {
    return;
  }

  validationError.throw({
    subject: `${kind} id`,
    id: id.length === 0 ? "<empty>" : id,
    originalError: `${kind} ids must be non-empty strings.`,
  });
}

/** Brands an id captured at a source boundary before it is interpreted. */
export function createSourceId(id: string): SourceId {
  return id as SourceId;
}

/** Validates and brands an unqualified local definition id. */
export function createLocalId(id: SourceId): LocalId {
  assertNonEmptyId("Local", id);

  if (id.includes(".")) {
    validationError.throw({
      subject: "Local id",
      id,
      originalError: `Local id "${id}" cannot contain ".".`,
    });
  }

  return id as LocalId;
}

/** Validates and brands a definition id after ownership compilation. */
export function createCanonicalId(id: string): CanonicalId {
  assertNonEmptyId("Canonical", id);

  if (id.startsWith(".") || id.endsWith(".") || id.includes("..")) {
    validationError.throw({
      subject: "Canonical id",
      id,
      originalError:
        "Canonical ids cannot start or end with a dot or contain consecutive dots.",
    });
  }

  return id as CanonicalId;
}

/** Brands a validated canonical id for use in a stateful framework index. */
export function createStorageId(id: CanonicalId): StorageId {
  return id as StorageId;
}
