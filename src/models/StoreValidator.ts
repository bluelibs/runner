import {
  duplicateTagIdOnDefinitionError,
  duplicateRegistrationError,
  middlewareNotRegisteredError,
  tagNotFoundError,
} from "../errors";
import { ITaggable } from "../defs";
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
}
