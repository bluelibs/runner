import {
  HookStoreElementType,
  ITag,
  symbolMiddlewareEverywhereResources,
} from "../defs";
import {
  DependencyNotFoundError,
  DuplicateRegistrationError,
  TagNotFoundError,
} from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
  ITaggable,
} from "../defs";
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
    if (this.registry.middlewares.has(id)) {
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
        if (!this.registry.middlewares.has(middlewareAttachment.id)) {
          throw new DependencyNotFoundError(
            `Middleware ${middlewareAttachment.id} in Task ${task.task.id}`,
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
      ...Array.from(this.registry.middlewares.values()).map(
        (x) => x.middleware,
      ),
      ...Array.from(this.registry.hooks.values()).map((x) => x),
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
