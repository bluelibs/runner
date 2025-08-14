import { DependencyNotFoundError, DuplicateRegistrationError } from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
} from "./StoreTypes";

export class StoreValidator {
  constructor(
    private tasks: Map<string | symbol, TaskStoreElementType>,
    private resources: Map<string | symbol, ResourceStoreElementType>,
    private events: Map<string | symbol, EventStoreElementType>,
    private middlewares: Map<string | symbol, MiddlewareStoreElementType>
  ) {}

  checkIfIDExists(id: string | symbol): void | never {
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
      task.task.middleware.forEach((middleware) => {
        if (!this.middlewares.has(middleware.id)) {
          throw new DependencyNotFoundError(
            `Middleware ${middleware.id.toString()} in Task ${task.task.id.toString()}`
          );
        }
      });
    }
  }
}
