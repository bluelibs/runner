import type { Store } from "../Store";

type PublicDefinitionStore = Pick<Store, "toPublicId"> & {
  toPublicDefinition?: <T extends { id: string }>(definition: T) => T;
};

export function toPublicDefinition<T extends { id: string }>(
  store: PublicDefinitionStore,
  definition: T,
): T {
  if (typeof store.toPublicDefinition === "function") {
    return store.toPublicDefinition(definition);
  }

  return {
    ...definition,
    id: store.toPublicId(definition),
  };
}
