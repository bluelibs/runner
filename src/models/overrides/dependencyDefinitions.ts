import type { StoreRegistry } from "../store/StoreRegistry";

/** Resource traversal is last so fallback instances created while wiring are included. */
export function* dependencyDefinitions(registry: StoreRegistry) {
  for (const { task } of registry.tasks.values()) yield task;
  for (const { hook } of registry.hooks.values()) yield hook;
  for (const { middleware } of registry.taskMiddlewares.values())
    yield middleware;
  for (const { middleware } of registry.resourceMiddlewares.values())
    yield middleware;
  for (const { resource } of registry.resources.values()) yield resource;
}
