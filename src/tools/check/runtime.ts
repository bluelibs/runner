import type { Match } from "./engine";
import type { hasClassSchemaMetadata } from "./classSchema";

type CheckRuntimeRegistry = {
  Match?: typeof Match;
  hasClassSchemaMetadata?: typeof hasClassSchemaMetadata;
};

const registry: CheckRuntimeRegistry = {};

export function registerCheckRuntime(values: CheckRuntimeRegistry): void {
  Object.assign(registry, values);
}

export function resetCheckRuntimeRegistry(): void {
  delete registry.Match;
  delete registry.hasClassSchemaMetadata;
}

export function getRegisteredCheckRuntime(): Required<CheckRuntimeRegistry> {
  if (!registry.Match || !registry.hasClassSchemaMetadata) {
    throw new Error(
      "Runner check runtime is not registered yet. Ensure the check module has been initialized before using schema-backed error definitions.",
    );
  }

  return registry as Required<CheckRuntimeRegistry>;
}
