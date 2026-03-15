import { StoringMode } from "./types";
import type { RunnerMode } from "../../types/runner";
import {
  overrideTargetNotRegisteredError,
  validationError,
} from "../../errors";

type OverrideTargetType =
  | "Task"
  | "Resource"
  | "Task middleware"
  | "Resource middleware"
  | "Hook";

type PreparedDefinition = {
  id: string;
  dependencies?: unknown;
  overrides?: unknown;
  config?: unknown;
};

type PrepareFreshValueInput<T extends PreparedDefinition, TMapValue> = {
  item: T;
  collection: Map<string, TMapValue>;
  key: keyof TMapValue;
  mode: StoringMode;
  config?: unknown;
  runtimeMode?: RunnerMode;
  overrideTargetType?: OverrideTargetType;
};

export class StoreRegistryDefinitionPreparer {
  private ensureDependenciesShape(definitionId: string, value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      validationError.throw({
        subject: "Dependencies",
        id: definitionId,
        originalError:
          "Dependencies must be an object map. If you use dependencies as a function, it must return an object.",
      });
    }
  }

  prepareFreshValue<T extends PreparedDefinition, TMapValue>({
    item,
    collection,
    key,
    mode,
    config,
    runtimeMode,
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
        mode: RunnerMode,
      ) => unknown;
      const effectiveConfig = config ?? currentItem.config;
      currentItem.dependencies = dependencyFactory(
        effectiveConfig,
        runtimeMode!,
      ) as T["dependencies"];
    }

    if (typeof currentItem.overrides === "function") {
      const overridesFactory = currentItem.overrides as (
        cfg: unknown,
        mode: RunnerMode,
      ) => unknown;
      const effectiveConfig = config ?? currentItem.config;
      currentItem.overrides = overridesFactory(
        effectiveConfig,
        runtimeMode!,
      ) as T["overrides"];
    }

    this.ensureDependenciesShape(currentItem.id, currentItem.dependencies);

    return currentItem;
  }
}
