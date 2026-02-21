import { StoringMode } from "./types";

type PreparedDefinition = {
  id: string;
  dependencies?: unknown;
  config?: unknown;
};

type PrepareFreshValueInput<T extends PreparedDefinition, TMapValue> = {
  item: T;
  collection: Map<string, TMapValue>;
  key: keyof TMapValue;
  mode: StoringMode;
  config?: unknown;
};

export class StoreRegistryDefinitionPreparer {
  prepareFreshValue<T extends PreparedDefinition, TMapValue>({
    item,
    collection,
    key,
    mode,
    config,
  }: PrepareFreshValueInput<T, TMapValue>): T {
    let currentItem: T;
    if (mode === "override") {
      const existing = collection.get(item.id)![key] as T;
      currentItem = { ...existing, ...item };
    } else {
      currentItem = { ...item };
    }

    if (typeof currentItem.dependencies === "function") {
      const dependencyFactory = currentItem.dependencies as (
        cfg: unknown,
      ) => unknown;
      const effectiveConfig = config ?? currentItem.config;
      currentItem.dependencies = dependencyFactory(
        effectiveConfig,
      ) as T["dependencies"];
    }

    return currentItem;
  }
}
