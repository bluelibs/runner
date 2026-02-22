import {
  wiringAccessPolicyInvalidEntryError,
  wiringAccessPolicyUnknownTargetError,
  duplicateTagIdOnDefinitionError,
  duplicateRegistrationError,
  middlewareNotRegisteredError,
  tagSelfDependencyError,
  tagNotFoundError,
} from "../errors";
import { ITaggable } from "../defs";
import {
  isOptional,
  isResourceWithConfig,
  isTag,
  isTagStartup,
} from "../define";
import { StoreRegistry } from "./StoreRegistry";

type SanityCheckTaggable = ITaggable & {
  id: string;
  tags?: ITaggable["tags"];
};

type TaggableEntry = {
  definitionType: string;
  definition: SanityCheckTaggable;
};

export class StoreValidator {
  private readonly registeredIds = new Set<string>();

  constructor(private registry: StoreRegistry) {
    this.seedRegisteredIds();
  }

  trackRegisteredId(id: string): void {
    this.registeredIds.add(id);
  }

  checkIfIDExists(id: string): void | never {
    if (!this.registeredIds.has(id)) {
      return;
    }

    if (this.registry.tasks.has(id)) {
      duplicateRegistrationError.throw({ type: "Task", id });
    }
    if (this.registry.resources.has(id)) {
      duplicateRegistrationError.throw({ type: "Resource", id });
    }
    if (this.registry.events.has(id)) {
      duplicateRegistrationError.throw({ type: "Event", id });
    }
    if (this.registry.errors.has(id)) {
      duplicateRegistrationError.throw({ type: "Error", id });
    }
    if (this.registry.asyncContexts.has(id)) {
      duplicateRegistrationError.throw({ type: "AsyncContext", id });
    }
    if (this.registry.taskMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id });
    }
    if (this.registry.resourceMiddlewares.has(id)) {
      duplicateRegistrationError.throw({ type: "Middleware", id });
    }
    if (this.registry.tags.has(id)) {
      duplicateRegistrationError.throw({ type: "Tag", id });
    }
    if (this.registry.hooks.has(id)) {
      duplicateRegistrationError.throw({ type: "Hook", id });
    }

    duplicateRegistrationError.throw({ type: "Unknown", id });
  }

  runSanityChecks() {
    for (const task of this.registry.tasks.values()) {
      const middlewares = task.task.middleware;
      middlewares.forEach((middlewareAttachment) => {
        if (!this.registry.taskMiddlewares.has(middlewareAttachment.id)) {
          middlewareNotRegisteredError.throw({
            type: "task",
            source: task.task.id,
            middlewareId: middlewareAttachment.id,
          });
        }
      });
    }

    for (const resource of this.registry.resources.values()) {
      const middlewares = resource.resource.middleware;
      middlewares.forEach((middlewareAttachment) => {
        if (!this.registry.resourceMiddlewares.has(middlewareAttachment.id)) {
          middlewareNotRegisteredError.throw({
            type: "resource",
            source: resource.resource.id,
            middlewareId: middlewareAttachment.id,
          });
        }
      });
    }

    this.ensureTagIdsAreUniquePerDefinition();
    this.ensureAllTagsUsedAreRegistered();
    this.ensureNoSelfTagDependencies();
    this.ensureWiringAccessPoliciesAreValid();

    // Validate module boundary visibility after all items are registered
    this.registry.visibilityTracker.validateVisibility(this.registry);
  }

  private ensureTagIdsAreUniquePerDefinition() {
    this.forEachTaggableEntry(({ definitionType, definition }) => {
      const tags = Array.isArray(definition.tags) ? definition.tags : [];
      const seenTagIds = new Set<string>();
      for (const tag of tags) {
        if (seenTagIds.has(tag.id)) {
          duplicateTagIdOnDefinitionError.throw({
            definitionType,
            definitionId: definition.id,
            tagId: tag.id,
          });
        }
        seenTagIds.add(tag.id);
      }
    });
  }

  ensureAllTagsUsedAreRegistered() {
    this.forEachTaggableEntry(({ definition }) => {
      const tags = Array.isArray(definition.tags) ? definition.tags : [];
      for (const tag of tags) {
        if (!this.registry.tags.has(tag.id)) {
          tagNotFoundError.throw({ id: tag.id });
        }
      }
    });
  }

  private ensureNoSelfTagDependencies() {
    this.forEachSelfTagDependencyEntry((entry) => {
      if (!entry.dependencies || typeof entry.dependencies !== "object") {
        return;
      }

      const ownTagIds = new Set(
        (Array.isArray(entry.tags) ? entry.tags : []).map((tag) => tag.id),
      );
      for (const dependency of Object.values(
        entry.dependencies as Record<string, unknown>,
      )) {
        const maybeDependency = isOptional(dependency)
          ? (dependency as { inner: unknown }).inner
          : dependency;
        const maybeTag = isTagStartup(maybeDependency)
          ? maybeDependency.tag
          : maybeDependency;

        if (!isTag(maybeTag)) {
          continue;
        }

        if (!ownTagIds.has(maybeTag.id)) {
          continue;
        }

        tagSelfDependencyError.throw({
          definitionType: entry.definitionType,
          definitionId: entry.definitionId,
          tagId: maybeTag.id,
        });
      }
    });
  }

  private ensureWiringAccessPoliciesAreValid() {
    for (const { resource } of this.registry.resources.values()) {
      const policy = resource.wiringAccessPolicy;
      if (!policy) {
        continue;
      }

      if (!Array.isArray(policy.deny)) {
        wiringAccessPolicyInvalidEntryError.throw({
          policyResourceId: resource.id,
          entry: policy,
        });
      }

      for (const entry of policy.deny) {
        const resolvedId = this.resolveWiringAccessPolicyTargetId(entry);
        if (!resolvedId) {
          wiringAccessPolicyInvalidEntryError.throw({
            policyResourceId: resource.id,
            entry,
          });
        } else if (!this.hasRegisteredId(resolvedId)) {
          wiringAccessPolicyUnknownTargetError.throw({
            policyResourceId: resource.id,
            targetId: resolvedId,
          });
        }
      }
    }
  }

  private resolveWiringAccessPolicyTargetId(entry: unknown): string | null {
    if (typeof entry === "string") {
      return entry.length > 0 ? entry : null;
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    if (isResourceWithConfig(entry)) {
      return entry.resource.id;
    }

    if (!("id" in entry)) {
      return null;
    }

    const id = (entry as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }

  private hasRegisteredId(id: string): boolean {
    return this.registeredIds.has(id);
  }

  private seedRegisteredIds() {
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

  private forEachTaggableEntry(callback: (entry: TaggableEntry) => void): void {
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

  private forEachSelfTagDependencyEntry(
    callback: (entry: {
      definitionType: string;
      definitionId: string;
      tags: ITaggable["tags"];
      dependencies: unknown;
    }) => void,
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
}
