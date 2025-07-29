import { defineTask, defineResource } from "../define";
import { run } from "../run";

describe("setOutput functionality", () => {
  it("should allow afterRun event listeners to modify task output", async () => {
    const originalTask = defineTask({
      id: "original.task",
      run: async (input: string) => `Hello, ${input}!`,
    });

    const transformListener = defineTask({
      id: "transform.listener",
      on: originalTask.events.afterRun,
      run: async (event) => {
        const transformedOutput = event.data.output.toUpperCase();
        event.data.setOutput(transformedOutput);
      },
    });

    const app = defineResource({
      id: "app",
      register: [originalTask, transformListener],
      dependencies: { originalTask },
      async init(_, { originalTask }) {
        const result = await originalTask("World");
        expect(result).toBe("HELLO, WORLD!");
        return result;
      },
    });

    await run(app);
  });

  it("should preserve original output if setOutput is not called", async () => {
    const originalTask = defineTask({
      id: "original.task",
      run: async (input: string) => `Hello, ${input}!`,
    });

    const observerListener = defineTask({
      id: "observer.listener",
      on: originalTask.events.afterRun,
      run: async (event) => {
        // Just observe, don't modify
        expect(event.data.output).toBe("Hello, World!");
      },
    });

    const app = defineResource({
      id: "app",
      register: [originalTask, observerListener],
      dependencies: { originalTask },
      async init(_, { originalTask }) {
        const result = await originalTask("World");
        expect(result).toBe("Hello, World!");
        return result;
      },
    });

    await run(app);
  });

  it("should handle multiple afterRun listeners with setOutput (last one wins)", async () => {
    const originalTask = defineTask({
      id: "original.task",
      run: async (input: number) => input * 2,
    });

    const firstTransform = defineTask({
      id: "first.transform",
      on: originalTask.events.afterRun,
      listenerOrder: 1,
      run: async (event) => {
        console.log("First transform - input output:", event.data.output);
        event.data.setOutput(event.data.output + 10);
        console.log("First transform - after setOutput:", event.data.output);
      },
    });

    const secondTransform = defineTask({
      id: "second.transform",
      on: originalTask.events.afterRun,
      listenerOrder: 2,
      run: async (event) => {
        console.log("Second transform - input output:", event.data.output);
        event.data.setOutput(event.data.output * 3);
        console.log("Second transform - after setOutput:", event.data.output);
      },
    });

    const app = defineResource({
      id: "app",
      register: [originalTask, firstTransform, secondTransform],
      dependencies: { originalTask },
      async init(_, { originalTask }) {
        const result = await originalTask(5);
        // Original: 5 * 2 = 10
        // First transform: 10 + 10 = 20
        // Second transform: 20 * 3 = 60
        expect(result).toBe(60);
        return result;
      },
    });

    await run(app);
  });

  it("should work with external library scenario", async () => {
    // Simulate an external library task
    const externalLibraryTask = defineTask({
      id: "external.library.task",
      run: async (data: { name: string; age: number }) => {
        return {
          id: Math.random(),
          name: data.name,
          age: data.age,
          timestamp: Date.now(),
        };
      },
    });

    // Create a transformer for the external task
    const resultTransformer = defineTask({
      id: "result.transformer",
      on: externalLibraryTask.events.afterRun,
      run: async (event) => {
        const result = event.data.output;
        // Add some computed fields
        const enrichedResult = {
          ...result,
          displayName: `${result.name} (${result.age} years old)`,
          isAdult: result.age >= 18,
        };
        event.data.setOutput(enrichedResult);
      },
    });

    const app = defineResource({
      id: "app",
      register: [externalLibraryTask, resultTransformer],
      dependencies: { externalLibraryTask },
      async init(_, { externalLibraryTask }) {
        const result = await externalLibraryTask({ name: "Alice", age: 25 });

        expect(result).toMatchObject({
          name: "Alice",
          age: 25,
          displayName: "Alice (25 years old)",
          isAdult: true,
        });
        expect(result.id).toBeDefined();
        expect(result.timestamp).toBeDefined();

        return result;
      },
    });

    await run(app);
  });

  it("should handle type safety with setOutput", async () => {
    interface TaskOutput {
      message: string;
      count: number;
    }

    const typedTask = defineTask({
      id: "typed.task",
      run: async (input: string): Promise<TaskOutput> => ({
        message: `Hello, ${input}!`,
        count: input.length,
      }),
    });

    const typedTransformer = defineTask({
      id: "typed.transformer",
      on: typedTask.events.afterRun,
      run: async (event) => {
        const result = event.data.output;
        const newResult: TaskOutput = {
          message: result.message.toUpperCase(),
          count: result.count * 2,
        };
        event.data.setOutput(newResult);
      },
    });

    const app = defineResource({
      id: "app",
      register: [typedTask, typedTransformer],
      dependencies: { typedTask },
      async init(_, { typedTask }) {
        const result = await typedTask("World");
        expect(result).toEqual({
          message: "HELLO, WORLD!",
          count: 10, // "World".length * 2
        });
        return result;
      },
    });

    await run(app);
  });

  it("should work with middleware and setOutput together", async () => {
    const { defineMiddleware } = await import("../define");

    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next, task }) => {
        const result = await next(task?.input);
        return `[middleware: ${result}]`;
      },
    });

    const originalTask = defineTask({
      id: "original.task",
      middleware: [testMiddleware],
      run: async (input: string) => `Hello, ${input}!`,
    });

    const outputTransformer = defineTask({
      id: "output.transformer",
      on: originalTask.events.afterRun,
      run: async (event) => {
        // The output here already includes middleware processing
        const transformed = event.data.output.replace(
          "middleware:",
          "processed:"
        );
        event.data.setOutput(transformed);
      },
    });

    const app = defineResource({
      id: "app",
      register: [testMiddleware, originalTask, outputTransformer],
      dependencies: { originalTask },
      async init(_, { originalTask }) {
        const result = await originalTask("World");
        expect(result).toBe("[processed: Hello, World!]");
        return result;
      },
    });

    await run(app);
  });
});
