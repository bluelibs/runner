import { symbolRuntimeId } from "../../types/symbols";
import type { Store } from "../Store";

type PublicDefinitionStore = Pick<Store, "toPublicId"> & {
  toPublicPath?: (reference: unknown) => string;
  toPublicDefinition?: <T extends { id: string }>(definition: T) => T;
};

export function toPublicDefinition<T extends { id: string }>(
  store: PublicDefinitionStore,
  definition: T,
): T {
  if (typeof store.toPublicDefinition === "function") {
    return store.toPublicDefinition(definition);
  }

  const publicId = store.toPublicId(definition);
  const publicPath =
    typeof store.toPublicPath === "function"
      ? store.toPublicPath(definition)
      : publicId;

  return {
    ...definition,
    id: publicId,
    path: publicPath,
    [symbolRuntimeId]: publicPath,
  };
}
