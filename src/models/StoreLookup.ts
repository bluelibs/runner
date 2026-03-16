import { isResourceWithConfig } from "../define";
import type { RegisterableItem } from "../defs";

type DefinitionWithOptionalId = {
  id?: unknown;
};

export interface StoreLookupAdapter {
  resolveDefinitionId?: (reference: unknown) => string | undefined;
  findDefinitionById?: (canonicalId: string) => RegisterableItem | undefined;
}

type StoreLookupFacade = {
  lookup?: Pick<
    StoreLookup,
    "tryCanonicalId" | "resolveCandidateId" | "extractRequestedId"
  >;
  hasDefinition?: (reference: unknown) => boolean;
  findIdByDefinition?: (reference: unknown) => string;
  resolveDefinitionId?: (reference: unknown) => string | undefined;
};

function readRequestedObjectId(reference: unknown): string | null {
  if (
    ((typeof reference === "object" && reference !== null) ||
      typeof reference === "function") &&
    "id" in reference
  ) {
    const id = (reference as DefinitionWithOptionalId).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return null;
}

export function extractRequestedId(reference: unknown): string | null {
  if (typeof reference === "string" && reference.length > 0) {
    return reference;
  }

  if (isResourceWithConfig(reference)) {
    return extractRequestedId(reference.resource);
  }

  return readRequestedObjectId(reference);
}

export class StoreLookup {
  constructor(private readonly adapter: StoreLookupAdapter) {}

  public tryCanonicalId(reference: unknown): string | null {
    const candidate = this.resolveCandidateId(reference);
    if (!candidate) {
      return null;
    }

    return this.tryDefinitionById(candidate) ? candidate : null;
  }

  public tryDefinitionById(canonicalId: string): RegisterableItem | null {
    return this.adapter.findDefinitionById?.(canonicalId) ?? null;
  }

  public resolveCandidateId(reference: unknown): string | null {
    return this.resolveCanonicalCandidate(reference);
  }

  public extractRequestedId(reference: unknown): string | null {
    return extractRequestedId(reference);
  }

  private resolveCanonicalCandidate(reference: unknown): string | null {
    const resolved = this.adapter.resolveDefinitionId?.(reference);
    if (typeof resolved === "string" && resolved.length > 0) {
      return resolved;
    }

    return this.extractRequestedId(reference);
  }
}

export function resolveCanonicalIdFromStore(
  store: StoreLookupFacade,
  reference: unknown,
): string | null {
  const lookupCanonicalId = store.lookup?.tryCanonicalId(reference);
  if (lookupCanonicalId) {
    return lookupCanonicalId;
  }

  if (
    typeof store.hasDefinition === "function" &&
    typeof store.findIdByDefinition === "function" &&
    store.hasDefinition(reference)
  ) {
    return store.findIdByDefinition(reference);
  }

  const resolved = store.resolveDefinitionId?.(reference);
  if (typeof resolved === "string" && resolved.length > 0) {
    return resolved;
  }

  return null;
}

export function resolveRequestedIdFromStore(
  store: StoreLookupFacade,
  reference: unknown,
): string | null {
  return (
    resolveCanonicalIdFromStore(store, reference) ??
    extractRequestedId(reference)
  );
}

export function toCanonicalDefinitionFromStore<
  TDefinition extends { id: string },
>(store: StoreLookupFacade, definition: TDefinition): TDefinition {
  const canonicalId = resolveRequestedIdFromStore(store, definition);
  if (!canonicalId) {
    return definition;
  }

  return {
    ...definition,
    id: canonicalId,
    path: canonicalId,
  } as TDefinition;
}
