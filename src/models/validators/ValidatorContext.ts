import type { StoreRegistry } from "../StoreRegistry";
import type { ITaggable } from "../../defs";
import { StoreLookup } from "../StoreLookup";

type SanityCheckTaggable = ITaggable & {
  id: string;
  tags?: ITaggable["tags"];
};

export type TaggableEntry = {
  definitionType: string;
  definition: SanityCheckTaggable;
};

export type SelfTagDependencyEntry = {
  definitionType: string;
  definitionId: string;
  tags: ITaggable["tags"];
  dependencies: unknown;
};

/**
 * Shared context for all StoreValidator sub-validators.
 * Provides registry access and common resolution helpers.
 */
export class ValidatorContext {
  private readonly registeredIds = new Set<string>();
  private readonly lookup: StoreLookup;

  constructor(public readonly registry: StoreRegistry) {
    this.lookup = new StoreLookup(registry);
    this.seedRegisteredIds();
  }

  trackRegisteredId(id: string): void {
    this.registeredIds.add(id);
  }

  hasRegisteredId(id: string): boolean {
    return this.registeredIds.has(id);
  }

  getRegisteredIds(): ReadonlySet<string> {
    return this.registeredIds;
  }

  /**
   * Returns the mutable registeredIds set for testing purposes.
   * @internal
   */
  getRegisteredIdsMutable(): Set<string> {
    return this.registeredIds;
  }

  resolveReferenceId(entry: unknown): string | null {
    const resolved = this.registry.resolveDefinitionId?.(entry);
    return typeof resolved === "string" && resolved.length > 0
      ? resolved
      : null;
  }

  findIdByDefinition(reference: unknown): string {
    return (
      this.lookup.tryCanonicalId(reference) ??
      this.lookup.extractRequestedId(reference) ??
      String(reference)
    );
  }

  forEachTaggableEntry(callback: (entry: TaggableEntry) => void): void {
    for (const { task } of this.registry.tasks.values()) {
      callback({ definitionType: "Task", definition: task });
    }
    for (const { resource } of this.registry.resources.values()) {
      callback({ definitionType: "Resource", definition: resource });
    }
    for (const { event } of this.registry.events.values()) {
      callback({ definitionType: "Event", definition: event });
    }
    for (const { middleware } of this.registry.taskMiddlewares.values()) {
      callback({ definitionType: "Task middleware", definition: middleware });
    }
    for (const { middleware } of this.registry.resourceMiddlewares.values()) {
      callback({
        definitionType: "Resource middleware",
        definition: middleware,
      });
    }
    for (const { hook } of this.registry.hooks.values()) {
      callback({ definitionType: "Hook", definition: hook });
    }
  }

  forEachSelfTagDependencyEntry(
    callback: (entry: SelfTagDependencyEntry) => void,
  ): void {
    for (const { task } of this.registry.tasks.values()) {
      callback({
        definitionType: "Task",
        definitionId: task.id,
        tags: task.tags,
        dependencies: task.dependencies,
      });
    }
    for (const { resource } of this.registry.resources.values()) {
      callback({
        definitionType: "Resource",
        definitionId: resource.id,
        tags: resource.tags,
        dependencies: resource.dependencies,
      });
    }
    for (const { hook } of this.registry.hooks.values()) {
      callback({
        definitionType: "Hook",
        definitionId: hook.id,
        tags: hook.tags,
        dependencies: hook.dependencies,
      });
    }
    for (const { middleware } of this.registry.taskMiddlewares.values()) {
      callback({
        definitionType: "Task middleware",
        definitionId: middleware.id,
        tags: middleware.tags,
        dependencies: middleware.dependencies,
      });
    }
    for (const { middleware } of this.registry.resourceMiddlewares.values()) {
      callback({
        definitionType: "Resource middleware",
        definitionId: middleware.id,
        tags: middleware.tags,
        dependencies: middleware.dependencies,
      });
    }
  }

  private seedRegisteredIds(): void {
    const registries = [
      this.registry.tasks,
      this.registry.resources,
      this.registry.events,
      this.registry.errors,
      this.registry.asyncContexts,
      this.registry.taskMiddlewares,
      this.registry.resourceMiddlewares,
      this.registry.tags,
      this.registry.hooks,
    ];

    for (const collection of registries) {
      for (const id of collection.keys()) {
        this.registeredIds.add(id);
      }
    }
  }
}
