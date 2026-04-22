import { defineResource, defineTask, defineTaskMiddleware } from "../../define";
import { run } from "../../run";
import {
  timeoutTaskMiddleware as timeoutMiddleware,
  timeoutResourceMiddleware,
} from "../../globals/middleware/timeout.middleware";
import { journal as executionJournal } from "../../models/ExecutionJournal";
import { genericError } from "../../errors";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Timeout Middleware", () => {
  it("should cleanup abort listener on success (task middleware)", async () => {
    const removeSpy = jest.spyOn(AbortSignal.prototype, "removeEventListener");
    removeSpy.mockClear();

    const journalInstance = executionJournal.create();
    let resolveNext: (value: string) => void = () => {};

    const nextPromise = new Promise<string>((res) => {
      resolveNext = res;
    });

    const promise = timeoutMiddleware.run(
      {
        task: { definition: { id: "spec-task" } as any, input: "x" },
        journal: journalInstance as any,
        next: () => nextPromise,
      },
      {},
      { ttl: 50 },
    );

    expect(
      journalInstance.has(timeoutMiddleware.journalKeys.abortController),
    ).toBe(true);

    resolveNext("ok");
    await expect(promise).resolves.toBe("ok");

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    removeSpy.mockRestore();
  });

  it("uses default ttl when task middleware config omits ttl", async () => {
    const journalInstance = executionJournal.create();

    const result = await timeoutMiddleware.run(
      {
        task: { definition: { id: "spec-task" } as any, input: "x" },
        journal: journalInstance as any,
        next: async () => "ok",
      },
      {},
      {},
    );

    expect(result).toBe("ok");
  });

  it("reuses pre-set abort controller from journal", async () => {
    const journalInstance = executionJournal.create();
    const presetController = new AbortController();
    journalInstance.set(
      timeoutMiddleware.journalKeys.abortController,
      presetController,
    );

    const result = await timeoutMiddleware.run(
      {
        task: { definition: { id: "spec-task" } as any, input: "x" },
        journal: journalInstance as any,
        next: () => Promise.resolve("ok"),
      },
      {},
      { ttl: 50 },
    );

    expect(result).toBe("ok");
    expect(
      journalInstance.get(timeoutMiddleware.journalKeys.abortController),
    ).toBe(presetController);
  });

  it("should cleanup abort listener on success (resource middleware)", async () => {
    const removeSpy = jest.spyOn(AbortSignal.prototype, "removeEventListener");
    removeSpy.mockClear();

    let resolveNext: (value: string) => void = () => {};

    const nextPromise = new Promise<string>((res) => {
      resolveNext = res;
    });

    const promise = timeoutResourceMiddleware.run(
      {
        resource: { definition: { id: "spec-resource" }, config: {} } as any,
        next: () => nextPromise,
      },
      {},
      { ttl: 50 },
    );

    resolveNext("ready");
    await expect(promise).resolves.toBe("ready");

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    removeSpy.mockRestore();
  });

  it("uses default ttl when resource middleware config omits ttl", async () => {
    const result = await timeoutResourceMiddleware.run(
      {
        resource: { definition: { id: "spec-resource" }, config: {} } as any,
        next: async () => "ready",
      },
      {},
      {},
    );

    expect(result).toBe("ready");
  });

  it("should abort long-running tasks after ttl", async () => {
    const slowTask = defineTask({
      id: "timeout-slowTask",
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
      id: "timeout-fastTask",
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
      id: "timeout-slowResource",
      middleware: [timeoutResourceMiddleware.with({ ttl: 20 })],
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
      id: "timeout-immediate",
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

  it("should throw immediately when ttl is 0 for resource", async () => {
    const slowResource = defineResource({
      id: "timeout-immediate-resource",
      middleware: [timeoutResourceMiddleware.with({ ttl: 0 })],
      async init() {
        return "never";
      },
    });

    const app = defineResource({
      id: "app",
      register: [slowResource],
    });

    await expect(run(app)).rejects.toThrow(/timed out/i);
  });

  it("should respect abort controller (task aborts early)", async () => {
    const abortingMiddleware = defineTaskMiddleware({
      id: "timeout-abort-trigger",
      async run({ task, journal, next }) {
        const controller = journal.get(
          timeoutMiddleware.journalKeys.abortController,
        );
        if (!controller) {
          throw genericError.new({ message: "AbortController not set" });
        }
        setTimeout(() => controller.abort(), 5);
        return next(task.input);
      },
    });

    const slowTask = defineTask({
      id: "timeout-abortTask",
      middleware: [timeoutMiddleware.with({ ttl: 50 }), abortingMiddleware],
      async run() {
        await sleep(40);
        return "done";
      },
    });

    const app = defineResource({
      id: "app",
      register: [slowTask, abortingMiddleware],
      dependencies: { slowTask },
      async init(_, { slowTask }) {
        await expect(slowTask()).rejects.toMatchObject({
          id: "cancellation",
        });
      },
    });

    await run(app);
  });

  it("should propagate errors thrown inside wrapped task", async () => {
    const failingTask = defineTask({
      id: "timeout-errorTask",
      middleware: [timeoutMiddleware.with({ ttl: 100 })],
      async run() {
        throw genericError.new({ message: "boom" });
      },
    });

    const app = defineResource({
      id: "app",
      register: [failingTask],
      dependencies: { failingTask },
      async init(_, { failingTask }) {
        await expect(failingTask()).rejects.toThrow(/boom/);
      },
    });

    await run(app);
  });

  it("should propagate resource init errors through timeout middleware", async () => {
    const brokenResource = defineResource({
      id: "timeout-errorResource",
      middleware: [timeoutResourceMiddleware.with({ ttl: 100 })],
      async init() {
        throw genericError.new({ message: "kaboom" });
      },
    });

    const app = defineResource({
      id: "app",
      register: [brokenResource],
    });

    await expect(run(app)).rejects.toThrow(/kaboom/);
  });

  it("should reject when the timeout timer fires (task middleware)", async () => {
    expect.assertions(1);
    jest.useFakeTimers();
    const journalInstance = executionJournal.create();
    try {
      const promise = timeoutMiddleware.run(
        {
          task: { definition: { id: "spec-task" } as any, input: "x" },
          journal: journalInstance as any,
          next: () =>
            new Promise(() => {
              /* never resolves */
            }),
        },
        {},
        { ttl: 5 },
      );
      jest.advanceTimersByTime(10);
      await expect(promise).rejects.toThrow(/timed out/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should reject when the timeout timer fires (resource middleware)", async () => {
    expect.assertions(1);
    jest.useFakeTimers();
    try {
      const promise = timeoutResourceMiddleware.run(
        {
          resource: { definition: { id: "spec-resource" }, config: {} } as any,
          next: () =>
            new Promise(() => {
              /* never resolves */
            }),
        },
        {},
        { ttl: 5 },
      );
      jest.advanceTimersByTime(10);
      await expect(promise).rejects.toThrow(/timed out/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should resolve resource init when within ttl", async () => {
    const quickResource = defineResource({
      id: "timeout-quickResource",
      middleware: [timeoutResourceMiddleware.with({ ttl: 50 })],
      async init() {
        await sleep(10);
        return "ready";
      },
    });

    const app = defineResource({
      id: "app",
      register: [quickResource],
    });

    const runtime = await run(app);
    await runtime.dispose();
  });
});
