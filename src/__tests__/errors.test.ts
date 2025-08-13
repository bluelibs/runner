import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";
import { 
  Errors,
  RuntimeError,
  DuplicateRegistrationError,
  DependencyNotFoundError,
  UnknownItemTypeError,
  CircularDependenciesError,
  EventNotFoundError,
  MiddlewareAlreadyGlobalError,
  LockedError,
  StoreAlreadyInitializedError,
} from "../errors";

describe("Errors", () => {
  it("should throw duplicateRegistration error", async () => {
    const task1 = defineTask({ id: "test.task", run: async () => {} });
    const task2 = defineTask({ id: "test.task", run: async () => {} });

    const app = defineResource({
      id: "app",
      register: [task1, task2],
    });

    await expect(run(app)).rejects.toThrow(
      Errors.duplicateRegistration("Task", "test.task").message
    );
  });

  it("should throw unknown item type error at task level", async () => {
    const task = defineTask({
      id: "test.task",
      dependencies: { nonExistentDep: {} as any },
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(Errors.unknownItemType({}).message);
  });

  it("should throw unknown item type error at resource level", async () => {
    const app = defineResource({
      id: "app",
      register: [
        {
          id: "nonExistent",
        } as any,
      ],
      async init(_, {}) {},
    });

    await expect(run(app)).rejects.toThrow(Errors.unknownItemType({}).message);
  });

  it("should throw circularDependencies error", async () => {
    const task1: any = defineTask({
      id: "task1",
      dependencies: (): any => ({ task2 }),
      run: async () => {},
    });

    const task2: any = defineTask({
      id: "task2",
      dependencies: { task1 },
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task1, task2],
    });

    await expect(run(app)).rejects.toThrow(/Circular dependencies detected/);
  });

  it("should throw eventNotFound error", async () => {
    const nonExistentEvent = { id: "non.existent.event" } as any;

    const task = defineTask({
      id: "test.task",
      on: nonExistentEvent,
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [task],
    });

    await expect(run(app)).rejects.toThrow(
      Errors.eventNotFound("non.existent.event").message
    );
  });

  it("should throw taskError", async () => {
    const errorTask = defineTask({
      id: "error.task",
      run: async () => {
        throw new Error("Task error");
      },
    });

    const app = defineResource({
      id: "app",
      register: [errorTask],
      dependencies: { errorTask },
      async init(_, { errorTask }) {
        await errorTask();
      },
    });

    await expect(run(app)).rejects.toThrow(/Task error/);
  });

  it("should throw resourceError", async () => {
    const errorResource = defineResource({
      id: "error.resource",
      init: async () => {
        if (true === true) {
          throw new Error("Resource error");
        }
      },
    });

    const app = defineResource({
      id: "app",
      register: [errorResource],
    });

    await expect(run(app)).rejects.toThrow(/Resource error/);
  });

  it("should throw an ambigous one", async () => {
    const res1 = defineResource({
      id: "res1",
    });

    const ev1 = defineEvent({
      id: "res1",
    });

    const app = defineResource({
      id: "app",
      register: [res1, ev1],
    });

    await expect(run(app)).rejects.toThrow(
      Errors.duplicateRegistration("Resource", "res1").message
    );
  });

  it("Should throw duplicate error for middlewares with the same id", async () => {
    const middleware1 = defineMiddleware({
      id: "middlewarex",
      run: async () => {},
    });

    const middleware2 = defineMiddleware({
      id: "middlewarex",
      run: async () => {},
    });

    const app = defineResource({
      id: "app",
      register: [middleware1, middleware2],
    });

    await expect(run(app)).rejects.toThrow(
      Errors.duplicateRegistration("Middleware", "middlewarex").message
    );
  });

  it("Should throw duplicate error for events with the same id", async () => {
    const ev1 = defineEvent({
      id: "ev1",
    });
    const ev2 = defineEvent({
      id: "ev1",
    });

    const app = defineResource({
      id: "app",
      register: [ev1, ev2],
    });

    await expect(run(app)).rejects.toThrow(
      Errors.duplicateRegistration("Event", "ev1").message
    );
  });

  it("should throw an error when a task depends on a non-registered task", async () => {
    const offTheGrid = defineTask({
      id: "test.off.the.grid",
      dependencies: { nonExistentTask: { id: "non" } as any },
      run: async () => {},
    });

    const task = defineTask({
      id: "test.task",
      dependencies: { offTheGrid },
      run: async (_, deps) => {
        throw "Should not even be here";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      Errors.dependencyNotFound("Task test.off.the.grid").message
    );
  });

  it("should throw when a task depends on a non-registered resource", async () => {
    const offTheGrid = defineResource({
      id: "test.off.the.grid",
      init: async () => {},
    });

    const task = defineTask({
      id: "test.task",
      dependencies: { offTheGrid },
      run: async () => {
        throw "Should not even be here";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    await expect(run(app)).rejects.toThrow(
      Errors.dependencyNotFound("Resource test.off.the.grid").message
    );
  });

  it("should throw error, when a double global() is used on a middleware", async () => {
    const first = defineMiddleware({
      id: "x",
      run: async () => {},
    }).everywhere();
    expect(() => first.everywhere()).toThrow(
      Errors.middlewareAlreadyGlobal("x").message
    );
  });

  describe("Error Classes", () => {
    it("should have correct error names and inheritance", () => {
      // Test base RuntimeError
      const baseError = new RuntimeError("test");
      expect(baseError.name).toBe("RuntimeError");
      expect(baseError).toBeInstanceOf(Error);
      expect(baseError).toBeInstanceOf(RuntimeError);

      // Test DuplicateRegistrationError
      const dupError = new DuplicateRegistrationError("Task", "test");
      expect(dupError.name).toBe("DuplicateRegistrationError");
      expect(dupError).toBeInstanceOf(Error);
      expect(dupError).toBeInstanceOf(RuntimeError);
      expect(dupError).toBeInstanceOf(DuplicateRegistrationError);

      // Test DependencyNotFoundError
      const depError = new DependencyNotFoundError("test");
      expect(depError.name).toBe("DependencyNotFoundError");
      expect(depError).toBeInstanceOf(RuntimeError);

      // Test UnknownItemTypeError
      const unknownError = new UnknownItemTypeError("test");
      expect(unknownError.name).toBe("UnknownItemTypeError");
      expect(unknownError).toBeInstanceOf(RuntimeError);

      // Test CircularDependenciesError
      const circularError = new CircularDependenciesError(["a", "b"]);
      expect(circularError.name).toBe("CircularDependenciesError");
      expect(circularError).toBeInstanceOf(RuntimeError);

      // Test EventNotFoundError
      const eventError = new EventNotFoundError("test");
      expect(eventError.name).toBe("EventNotFoundError");
      expect(eventError).toBeInstanceOf(RuntimeError);

      // Test MiddlewareAlreadyGlobalError
      const middlewareError = new MiddlewareAlreadyGlobalError("test");
      expect(middlewareError.name).toBe("MiddlewareAlreadyGlobalError");
      expect(middlewareError).toBeInstanceOf(RuntimeError);

      // Test LockedError
      const lockedError = new LockedError("test");
      expect(lockedError.name).toBe("LockedError");
      expect(lockedError).toBeInstanceOf(RuntimeError);

      // Test StoreAlreadyInitializedError
      const storeError = new StoreAlreadyInitializedError();
      expect(storeError.name).toBe("StoreAlreadyInitializedError");
      expect(storeError).toBeInstanceOf(RuntimeError);
    });

    it("should create correct error types via Errors object", () => {
      // Test that Errors object creates the right instances
      const dupError = Errors.duplicateRegistration("Task", "test");
      expect(dupError).toBeInstanceOf(DuplicateRegistrationError);
      expect(dupError.name).toBe("DuplicateRegistrationError");

      const depError = Errors.dependencyNotFound("test");
      expect(depError).toBeInstanceOf(DependencyNotFoundError);
      expect(depError.name).toBe("DependencyNotFoundError");

      const unknownError = Errors.unknownItemType({});
      expect(unknownError).toBeInstanceOf(UnknownItemTypeError);
      expect(unknownError.name).toBe("UnknownItemTypeError");

      const circularError = Errors.circularDependencies(["a", "b"]);
      expect(circularError).toBeInstanceOf(CircularDependenciesError);
      expect(circularError.name).toBe("CircularDependenciesError");

      const eventError = Errors.eventNotFound("test");
      expect(eventError).toBeInstanceOf(EventNotFoundError);
      expect(eventError.name).toBe("EventNotFoundError");

      const middlewareError = Errors.middlewareAlreadyGlobal("test");
      expect(middlewareError).toBeInstanceOf(MiddlewareAlreadyGlobalError);
      expect(middlewareError.name).toBe("MiddlewareAlreadyGlobalError");

      const lockedError = Errors.locked("test");
      expect(lockedError).toBeInstanceOf(LockedError);
      expect(lockedError.name).toBe("LockedError");

      const storeError = Errors.storeAlreadyInitialized();
      expect(storeError).toBeInstanceOf(StoreAlreadyInitializedError);
      expect(storeError.name).toBe("StoreAlreadyInitializedError");
    });
  });
});
