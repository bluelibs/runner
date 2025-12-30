import {
  duplicateRegistrationError,
  middlewareNotRegisteredError,
  tagNotFoundError,
} from "../errors";
import { ITaggable } from "../defs";
import { StoreRegistry } from "./StoreRegistry";

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
            tagNotFoundError.throw({ id: tag.id });
          }
        }
      }
    }
  }
}
