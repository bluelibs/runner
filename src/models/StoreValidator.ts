import { symbolMiddlewareEverywhereResources } from "../defs";
import { DependencyNotFoundError, DuplicateRegistrationError } from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
} from "../defs";

export class StoreValidator {
  constructor(
    private tasks: Map<string, TaskStoreElementType>,
    private resources: Map<string, ResourceStoreElementType>,
    private events: Map<string, EventStoreElementType>,
    private middlewares: Map<string, MiddlewareStoreElementType>
  ) {}

  checkIfIDExists(id: string): void | never {
    if (this.tasks.has(id)) {
      throw new DuplicateRegistrationError("Task", id);
    }
    if (this.resources.has(id)) {
      throw new DuplicateRegistrationError("Resource", id);
    }
    if (this.events.has(id)) {
      throw new DuplicateRegistrationError("Event", id);
    }
    if (this.middlewares.has(id)) {
      throw new DuplicateRegistrationError("Middleware", id);
    }
  }

  runSanityChecks() {
    for (const task of this.tasks.values()) {
      const middlewares = task.task.middleware;
      middlewares.forEach((middlewareAttachment) => {
        if (!this.middlewares.has(middlewareAttachment.id)) {
          throw new DependencyNotFoundError(
            `Middleware ${middlewareAttachment.id} in Task ${task.task.id}`
          );
        }
      });
    }
  }
}
