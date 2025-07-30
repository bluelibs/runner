import { Errors } from "../errors";
import { TaskStoreElementType, MiddlewareStoreElementType, ResourceStoreElementType, EventStoreElementType } from "./StoreTypes";

export class StoreValidator {
  constructor(
    private tasks: Map<string, TaskStoreElementType>,
    private resources: Map<string, ResourceStoreElementType>,
    private events: Map<string, EventStoreElementType>,
    private middlewares: Map<string, MiddlewareStoreElementType>
  ) {}

  checkIfIDExists(id: string): void | never {
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
            `Middleware ${middleware.id} in Task ${task.task.id}`
          );
        }
      });
    }
  }
}