import { Errors } from "../errors";
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
      throw Errors.duplicateRegistration("Task", id);
    }
    if (this.resources.has(id)) {
      throw Errors.duplicateRegistration("Resource", id);
    }
    if (this.events.has(id)) {
      throw Errors.duplicateRegistration("Event", id);
    }
    if (this.middlewares.has(id)) {
      throw Errors.duplicateRegistration("Middleware", id);
    }
  }

  runSanityChecks() {
    for (const task of this.tasks.values()) {
      task.task.middleware.forEach((middleware) => {
        if (!this.middlewares.has(middleware.id)) {
          throw Errors.dependencyNotFound(
            `Middleware ${middleware.id.toString()} in Task ${task.task.id.toString()}`
          );
        }
      });
    }
  }
}
