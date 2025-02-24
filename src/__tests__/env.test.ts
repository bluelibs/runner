import { env, run } from "../index";
import { defineTask, defineResource } from "../define";

describe("Environment Manager", () => {
  // Save original process.env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original process.env after all tests
    process.env = originalEnv;
  });

  it("should get and set environment variables", async () => {
    const testTask = defineTask({
      id: "test.env.task",
      dependencies: {
        env,
      },
      async run(_, { env }) {
        // Set with a default value
        const value1 = env.set("TEST_VAR1", { defaultValue: "default-value" });
        expect(value1).toBe("default-value");

        // Set with process.env value
        process.env.TEST_VAR2 = "env-value";
        const value2 = env.set("TEST_VAR2", { defaultValue: "default-value" });
        expect(value2).toBe("env-value");

        // Get existing variable
        const value3 = env.get("TEST_VAR1");
        expect(value3).toBe("default-value");

        // Get non-existing variable with default
        const value4 = env.get("NON_EXISTING", "fallback");
        expect(value4).toBe("fallback");

        return true;
      },
    });

    const app = defineResource({
      id: "app",
      register: [testTask, env],
      dependencies: {
        testTask,
      },
      async init(_, { testTask }) {
        return testTask();
      },
    });

    const result = await run(app);
    expect(result).toBe(true);
  });

  it("should cast variables to different types", async () => {
    process.env.NUM_VAR = "123.45";
    process.env.BOOL_VAR_TRUE = "true";
    process.env.BOOL_VAR_FALSE = "false";
    process.env.DATE_VAR = "2023-01-01";

    const testTask = defineTask({
      id: "test.env.cast.task",
      dependencies: {
        env,
      },
      async run(_, { env }) {
        // Number casting
        const numVar = env.set("NUM_VAR", { cast: "number" });
        expect(numVar).toBe(123.45);
        expect(typeof numVar).toBe("number");

        // Boolean casting
        const boolVarTrue = env.set("BOOL_VAR_TRUE", { cast: "boolean" });
        expect(boolVarTrue).toBe(true);
        expect(typeof boolVarTrue).toBe("boolean");

        const boolVarFalse = env.set("BOOL_VAR_FALSE", { cast: "boolean" });
        expect(boolVarFalse).toBe(false);
        expect(typeof boolVarFalse).toBe("boolean");

        // Date casting
        const dateVar = env.set("DATE_VAR", { cast: "date" });
        expect(dateVar instanceof Date).toBe(true);
        expect(dateVar.getFullYear()).toBe(2023);

        return true;
      },
    });

    const app = defineResource({
      id: "app",
      register: [testTask, env],
      dependencies: {
        testTask,
      },
      async init(_, { testTask }) {
        return testTask();
      },
    });

    const result = await run(app);
    expect(result).toBe(true);
  });

  it("should allow adding custom cast handlers", async () => {
    process.env.JSON_VAR = '{"name":"test","value":123}';

    const testTask = defineTask({
      id: "test.env.custom.cast.task",
      dependencies: {
        env,
      },
      async run(_, { env }) {
        // Add custom JSON parser
        env.addCastHandler("json", (value) => JSON.parse(value));

        // Use custom cast handler
        const jsonVar = env.set("JSON_VAR", { cast: "json" });
        expect(typeof jsonVar).toBe("object");
        expect(jsonVar.name).toBe("test");
        expect(jsonVar.value).toBe(123);

        return true;
      },
    });

    const app = defineResource({
      id: "app",
      register: [testTask, env],
      dependencies: {
        testTask,
      },
      async init(_, { testTask }) {
        return testTask();
      },
    });

    const result = await run(app);
    expect(result).toBe(true);
  });
});
