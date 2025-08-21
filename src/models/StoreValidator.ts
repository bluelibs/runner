import { HookStoreElementType, ITag } from "../defs";
import {
  DependencyNotFoundError,
  DuplicateRegistrationError,
  MiddlewareNotRegisteredError,
  TagNotFoundError,
} from "../errors";
import { ITaggable } from "../defs";
import { Store } from "./Store";
import { StoreRegistry } from "./StoreRegistry";

export class StoreValidator {
  constructor(private registry: StoreRegistry) {}

  checkIfIDExists(id: string): void | never {
    if (this.registry.tasks.has(id)) {
      throw new DuplicateRegistrationError("Task", id);
    }
    if (this.registry.resources.has(id)) {
      throw new DuplicateRegistrationError("Resource", id);
    }
    if (this.registry.events.has(id)) {
      throw new DuplicateRegistrationError("Event", id);
    }
    if (this.registry.taskMiddlewares.has(id)) {
      throw new DuplicateRegistrationError("Middleware", id);
    }
    if (this.registry.resourceMiddlewares.has(id)) {
      throw new DuplicateRegistrationError("Middleware", id);
    }
    if (this.registry.tags.has(id)) {
      throw new DuplicateRegistrationError("Tag", id);
    }
    if (this.registry.hooks.has(id)) {
      throw new DuplicateRegistrationError("Hook", id);
    }
  }

  runSanityChecks() {
    for (const task of this.registry.tasks.values()) {
      const middlewares = task.task.middleware;
      middlewares.forEach((middlewareAttachment) => {
        if (!this.registry.taskMiddlewares.has(middlewareAttachment.id)) {
          throw new MiddlewareNotRegisteredError(
            "task",
            task.task.id,
            middlewareAttachment.id,
          );
        }
      });
    }

    for (const resource of this.registry.resources.values()) {
      const middlewares = resource.resource.middleware;
      middlewares.forEach((middlewareAttachment) => {
        if (!this.registry.resourceMiddlewares.has(middlewareAttachment.id)) {
          throw new MiddlewareNotRegisteredError(
            "resource",
            resource.resource.id,
            middlewareAttachment.id,
          );
        }
      });
    }

    this.ensureAllTagsUsedAreRegistered();
  }

  ensureAllTagsUsedAreRegistered() {
    const taggables: ITaggable[] = [
      ...Array.from(this.registry.tasks.values()).map((x) => x.task),
      ...Array.from(this.registry.resources.values()).map((x) => x.resource),
      ...Array.from(this.registry.events.values()).map((x) => x.event),
      ...Array.from(this.registry.taskMiddlewares.values()).map(
        (x) => x.middleware,
      ),
      ...Array.from(this.registry.resourceMiddlewares.values()).map(
        (x) => x.middleware,
      ),
      ...Array.from(this.registry.hooks.values()).map((x) => x.hook),
    ];

    for (const taggable of taggables) {
      const tags = taggable.tags;
      if (tags) {
        for (const tag of tags) {
          if (!this.registry.tags.has(tag.id)) {
            throw new TagNotFoundError(tag.id);
          }
        }
      }
    }
  }
}
