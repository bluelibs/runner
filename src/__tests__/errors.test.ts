import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "../define";
import { run } from "../run";
import { Errors } from "../errors";

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
});
