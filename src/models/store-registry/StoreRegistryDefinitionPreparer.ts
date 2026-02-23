import { StoringMode } from "./types";
import { overrideTargetNotRegisteredError } from "../../errors";

type OverrideTargetType =
  | "Task"
  | "Resource"
  | "Task middleware"
  | "Resource middleware"
  | "Hook";

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
  overrideTargetType?: OverrideTargetType;
};

export class StoreRegistryDefinitionPreparer {
  prepareFreshValue<T extends PreparedDefinition, TMapValue>({
    item,
    collection,
    key,
    mode,
    config,
    overrideTargetType,
  }: PrepareFreshValueInput<T, TMapValue>): T {
    let currentItem: T;
    if (mode === "override") {
      const existingEntry = collection.get(item.id);
      if (!existingEntry) {
        overrideTargetNotRegisteredError.throw({
          targetId: item.id,
          targetType: overrideTargetType ?? "Resource",
        });
      }
      const existing = existingEntry![key] as T;
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
