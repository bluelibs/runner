import {
  dependencyAccessPolicyInvalidEntryError,
  dependencyAccessPolicyUnknownTargetError,
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
  isTagBeforeInit,
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
  constructor(private registry: StoreRegistry) {}

  checkIfIDExists(id: string): void | never {
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
    this.ensureDependencyAccessPoliciesAreValid();

    // Validate module boundary visibility after all items are registered
    this.registry.visibilityTracker.validateVisibility(this.registry);
  }

  private getTaggableEntries(): TaggableEntry[] {
    return [
      ...Array.from(this.registry.tasks.values()).map((x) => ({
        definitionType: "Task",
        definition: x.task,
      })),
      ...Array.from(this.registry.resources.values()).map((x) => ({
        definitionType: "Resource",
        definition: x.resource,
      })),
      ...Array.from(this.registry.events.values()).map((x) => ({
        definitionType: "Event",
        definition: x.event,
      })),
      ...Array.from(this.registry.taskMiddlewares.values()).map((x) => ({
        definitionType: "Task middleware",
        definition: x.middleware,
      })),
      ...Array.from(this.registry.resourceMiddlewares.values()).map((x) => ({
        definitionType: "Resource middleware",
        definition: x.middleware,
      })),
      ...Array.from(this.registry.hooks.values()).map((x) => ({
        definitionType: "Hook",
        definition: x.hook,
      })),
    ];
  }

  private ensureTagIdsAreUniquePerDefinition() {
    for (const { definitionType, definition } of this.getTaggableEntries()) {
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
    }
  }

  ensureAllTagsUsedAreRegistered() {
    for (const { definition } of this.getTaggableEntries()) {
      const tags = Array.isArray(definition.tags) ? definition.tags : [];
      for (const tag of tags) {
        if (!this.registry.tags.has(tag.id)) {
          tagNotFoundError.throw({ id: tag.id });
        }
      }
    }
  }

  private ensureNoSelfTagDependencies() {
    const entries: Array<{
      definitionType: string;
      definitionId: string;
      tags: ITaggable["tags"];
      dependencies: unknown;
    }> = [
      ...Array.from(this.registry.tasks.values()).map((x) => ({
        definitionType: "Task",
        definitionId: x.task.id,
        tags: x.task.tags,
        dependencies: x.task.dependencies,
      })),
      ...Array.from(this.registry.resources.values()).map((x) => ({
        definitionType: "Resource",
        definitionId: x.resource.id,
        tags: x.resource.tags,
        dependencies: x.resource.dependencies,
      })),
      ...Array.from(this.registry.hooks.values()).map((x) => ({
        definitionType: "Hook",
        definitionId: x.hook.id,
        tags: x.hook.tags,
        dependencies: x.hook.dependencies,
      })),
      ...Array.from(this.registry.taskMiddlewares.values()).map((x) => ({
        definitionType: "Task middleware",
        definitionId: x.middleware.id,
        tags: x.middleware.tags,
        dependencies: x.middleware.dependencies,
      })),
      ...Array.from(this.registry.resourceMiddlewares.values()).map((x) => ({
        definitionType: "Resource middleware",
        definitionId: x.middleware.id,
        tags: x.middleware.tags,
        dependencies: x.middleware.dependencies,
      })),
    ];

    for (const entry of entries) {
      if (!entry.dependencies || typeof entry.dependencies !== "object") {
        continue;
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
        const maybeTag = isTagBeforeInit(maybeDependency)
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
    }
  }

  private ensureDependencyAccessPoliciesAreValid() {
    for (const { resource } of this.registry.resources.values()) {
      const policy = resource.dependencyAccessPolicy;
      if (!policy) {
        continue;
      }

      if (!Array.isArray(policy.deny)) {
        dependencyAccessPolicyInvalidEntryError.throw({
          policyResourceId: resource.id,
          entry: policy,
        });
      }

      for (const entry of policy.deny) {
        const resolvedId = this.resolveDependencyAccessPolicyTargetId(entry);
        if (!resolvedId) {
          dependencyAccessPolicyInvalidEntryError.throw({
            policyResourceId: resource.id,
            entry,
          });
        } else if (!this.hasRegisteredId(resolvedId)) {
          dependencyAccessPolicyUnknownTargetError.throw({
            policyResourceId: resource.id,
            targetId: resolvedId,
          });
        }
      }
    }
  }

  private resolveDependencyAccessPolicyTargetId(entry: unknown): string | null {
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
    return (
      this.registry.tasks.has(id) ||
      this.registry.resources.has(id) ||
      this.registry.events.has(id) ||
      this.registry.errors.has(id) ||
      this.registry.asyncContexts.has(id) ||
      this.registry.taskMiddlewares.has(id) ||
      this.registry.resourceMiddlewares.has(id) ||
      this.registry.tags.has(id) ||
      this.registry.hooks.has(id)
    );
  }
}
