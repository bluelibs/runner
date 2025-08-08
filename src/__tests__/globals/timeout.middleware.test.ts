import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { timeoutMiddleware } from "../../globals/middleware/timeout.middleware";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Timeout Middleware", () => {
  it("should abort long-running tasks after ttl", async () => {
    const slowTask = defineTask({
      id: "timeout.slowTask",
      middleware: [timeoutMiddleware.with({ ttl: 20 })],
      run: async () => {
        await sleep(50);
        return "done";
      },
    });

    const app = defineResource({
      id: "app",
      register: [slowTask],
      dependencies: { slowTask },
      async init(_, { slowTask }) {
        await expect(slowTask()).rejects.toThrow(/timed out/i);
      },
    });

    await run(app);
  });

  it("should allow tasks to complete before ttl", async () => {
    const fastTask = defineTask({
      id: "timeout.fastTask",
      middleware: [timeoutMiddleware.with({ ttl: 50 })],
      run: async () => {
        await sleep(10);
        return "ok";
      },
    });

    const app = defineResource({
      id: "app",
      register: [fastTask],
      dependencies: { fastTask },
      async init(_, { fastTask }) {
        await expect(fastTask()).resolves.toBe("ok");
      },
    });

    await run(app);
  });

  it("should timeout resource initialization", async () => {
    const slowResource = defineResource({
      id: "timeout.slowResource",
      middleware: [timeoutMiddleware.with({ ttl: 20 })],
      async init() {
        await sleep(50);
        return "ready";
      },
    });

    const app = defineResource({
      id: "app",
      register: [slowResource],
    });

    await expect(run(app)).rejects.toThrow(/timed out/i);
  });

  it("should throw immediately when ttl is 0", async () => {
    const task = defineTask({
      id: "timeout.immediate",
      middleware: [timeoutMiddleware.with({ ttl: 0 })],
      run: async () => "never",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow(/timed out/i);
      },
    });

    await run(app);
  });
});
