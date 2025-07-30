import { ITask, IResource } from "./defs";

export const Errors = {
  duplicateRegistration: (type: string, id: string) =>
    new Error(`${type} "${id}" already registered`),

  dependencyNotFound: (key: string) =>
    new Error(
      `Dependency ${key} not found. Did you forget to register it through a resource?`
    ),

  unknownItemType: (item: any) => new Error(`Unknown item type: ${item}`),

  circularDependencies: (cycles: string[]) =>
    new Error(`Circular dependencies detected: ${cycles.join(", ")}`),

  eventNotFound: (id: string) =>
    new Error(`Event "${id}" not found. Did you forget to register it?`),

  middlewareAlreadyGlobal: (id: string) =>
    new Error(
      "Cannot call .everywhere() on an already global middleware: " + id
    ),

  locked: (what: string) =>
    new Error(`Cannot modify the ${what} when it is locked.`),

  storeAlreadyInitialized: () =>
    new Error("Store already initialized. Cannot reinitialize."),
};
