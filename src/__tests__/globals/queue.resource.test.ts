import { defineResource } from "../../define";
import { run } from "../../run";
import { queueResource } from "../../globals/resources/queue.resource";
import { genericError } from "../../errors";

describe("Queue Resource", () => {
  it("should provide queue functionality with proper isolation and disposal", async () => {
    let callCount = 0;
    const executionOrder: number[] = [];
    let successCallCount = 0;

    const app = defineResource({
      id: "app",
      // Don't register queueResource - it's already registered globally
      dependencies: { queue: queueResource },
      async init(_, { queue }) {
        // Test 1: Initialize with empty queue map
        expect(queue.map).toBeInstanceOf(Map);
        expect(queue.map.size).toBe(0);
        expect(typeof queue.run).toBe("function");

        // Test 2: Create and reuse queues by ID
        const task = async () => {
          callCount++;
          return `result-${callCount}`;
        };

        const result1 = await queue.run("test-queue", task);
        expect(queue.map.size).toBe(1);
        expect(queue.map.has("test-queue")).toBe(true);

        const result2 = await queue.run("test-queue", task);
        expect(queue.map.size).toBe(1);
        expect(result1).toBe("result-1");
        expect(result2).toBe("result-2");

        // Test 3: Create separate queues for different IDs
        const task1 = async () => "queue1-result";
        const task2 = async () => "queue2-result";

        await queue.run("queue-1", task1);
        await queue.run("queue-2", task2);

        expect(queue.map.size).toBe(3); // test-queue, queue-1, queue-2
        expect(queue.map.has("queue-1")).toBe(true);
        expect(queue.map.has("queue-2")).toBe(true);

        // Test 4: Ensure tasks run sequentially within the same queue
        const taskFactory = (id: number) => async () => {
          executionOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, 1));
          return id;
        };

        const promises = [
          queue.run("sequential-queue", taskFactory(1)),
          queue.run("sequential-queue", taskFactory(2)),
          queue.run("sequential-queue", taskFactory(3)),
        ];

        const results = await Promise.all(promises);
        expect(results).toEqual([1, 2, 3]);
        expect(executionOrder).toEqual([1, 2, 3]);
        expect(queue.map.size).toBe(4); // Added sequential-queue

        // Test 5: Handle async tasks properly
        const asyncTask = async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return "async-result";
        };

        const asyncResult = await queue.run("async-queue", asyncTask);
        expect(asyncResult).toBe("async-result");
        expect(queue.map.size).toBe(5); // Added async-queue

        // Test 6: Handle errors in tasks without breaking the queue
        const errorTask = async () => {
          throw genericError.new({ message: "Task failed" });
        };

        const successTask = async () => {
          successCallCount++;
          return `success-${successCallCount}`;
        };

        await expect(queue.run("error-queue", errorTask)).rejects.toThrow(
          "Task failed",
        );

        const successResult = await queue.run("error-queue", successTask);
        expect(successResult).toBe("success-1");
        expect(queue.map.size).toBe(6); // Added error-queue

        return queue;
      },
    });

    const result = await run(app);

    // Test 7: Dispose all queues when resource is disposed
    expect(result.value.map.size).toBe(6);

    await result.dispose();

    // Try to run a task on a disposed queue resource - should reject
    await expect(
      result.value.run("test-queue", async () => "test"),
    ).rejects.toThrow(/disposed/);
  });

  it("should propagate task exceptions to the caller", async () => {
    const app = defineResource({
      id: "exception-test-app",
      dependencies: { queue: queueResource },
      async init(_, { queue }) {
        // Test that exceptions from tasks are properly propagated
        const errorTask = async () => {
          throw genericError.new({ message: "Queue resource task error" });
        };

        const successTask = async () => "success";

        // Exception should be catchable by the caller
        await expect(queue.run("error-queue", errorTask)).rejects.toThrow(
          "Queue resource task error",
        );

        // Queue should still work for subsequent tasks
        await expect(queue.run("error-queue", successTask)).resolves.toBe(
          "success",
        );

        // Multiple exceptions should all be catchable
        await expect(queue.run("error-queue", errorTask)).rejects.toThrow(
          "Queue resource task error",
        );
      },
    });

    await run(app);
  });

  it("evicts idle queues after inactivity timeout", async () => {
    jest.useFakeTimers();

    try {
      const app = defineResource({
        id: "queue-idle-eviction-app",
        dependencies: { queue: queueResource },
        async init(_, { queue }) {
          await queue.run("idle-queue", async () => "ok");
          expect(queue.map.has("idle-queue")).toBe(true);
          return queue;
        },
      });

      const runtime = await run(app);

      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      expect(runtime.value.map.has("idle-queue")).toBe(false);

      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("handles idle cleanup timer when queue entry was removed manually", async () => {
    jest.useFakeTimers();

    try {
      const app = defineResource({
        id: "queue-manual-removal-app",
        dependencies: { queue: queueResource },
        async init(_, { queue }) {
          await queue.run("manual-remove", async () => "ok");
          return queue;
        },
      });

      const runtime = await run(app);
      runtime.value.map.delete("manual-remove");

      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      expect(runtime.value.map.has("manual-remove")).toBe(false);
      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("tears down active queues during runtime disposal and waits for cancellation", async () => {
    const app = defineResource({
      id: "queue-runtime-teardown-app",
      dependencies: { queue: queueResource },
      async init(_, { queue }) {
        return queue;
      },
    });

    const runtime = await run(app);
    let startedQueuedTask = false;
    let runningTaskAborted = false;

    const running = runtime.value.run(
      "teardown-queue",
      async (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              runningTaskAborted = true;
              resolve();
            },
            { once: true },
          );
        }),
    );

    const queued = runtime.value.run("teardown-queue", async () => {
      startedQueuedTask = true;
      return "should-not-run";
    });
    const queuedResult = queued.catch((error) => error);

    await Promise.resolve();

    const disposePromise = runtime.dispose();

    await expect(running).resolves.toBeUndefined();
    await expect(queuedResult).resolves.toMatchObject({
      message: expect.stringContaining("Operation was aborted"),
    });
    await expect(disposePromise).resolves.toBeUndefined();
    expect(runningTaskAborted).toBe(true);
    expect(startedQueuedTask).toBe(false);
  });

  it("surfaces queue teardown failures during runtime disposal", async () => {
    const app = defineResource({
      id: "queue-runtime-teardown-failure-app",
      dependencies: { queue: queueResource },
      async init(_, { queue }) {
        await queue.run("failing-queue", async () => "ok");
        return queue;
      },
    });

    const runtime = await run(app);
    const queue = runtime.value.map.get("failing-queue");
    if (!queue) {
      throw genericError.new({ message: "Expected failing-queue to exist" });
    }

    const teardownError = new Error("queue teardown failed");
    queue.dispose = jest.fn().mockRejectedValue(teardownError);

    await expect(runtime.dispose()).rejects.toThrow("queue teardown failed");
  });

  it("aggregates multiple queue teardown failures and normalizes non-Error rejections", async () => {
    const app = defineResource({
      id: "queue-runtime-teardown-aggregate-failure-app",
      dependencies: { queue: queueResource },
      async init(_, { queue }) {
        await queue.run("failing-queue-a", async () => "ok-a");
        await queue.run("failing-queue-b", async () => "ok-b");
        return queue;
      },
    });

    const runtime = await run(app);
    const queueA = runtime.value.map.get("failing-queue-a");
    const queueB = runtime.value.map.get("failing-queue-b");

    if (!queueA || !queueB) {
      throw genericError.new({
        message: "Expected both failing queues to exist",
      });
    }

    queueA.dispose = jest.fn().mockRejectedValue("string failure");
    queueB.dispose = jest.fn().mockRejectedValue(new Error("error failure"));

    await expect(runtime.dispose()).rejects.toMatchObject({
      name: "AggregateError",
      message: "One or more queues failed to dispose.",
      cause: expect.objectContaining({
        message: "string failure",
      }),
      errors: [
        expect.objectContaining({ message: "string failure" }),
        expect.objectContaining({ message: "error failure" }),
      ],
    });
  });

  it("swallows idle-eviction teardown failures", async () => {
    jest.useFakeTimers();

    try {
      const app = defineResource({
        id: "queue-idle-eviction-failure-app",
        dependencies: { queue: queueResource },
        async init(_, { queue }) {
          await queue.run("idle-failure", async () => "ok");
          return queue;
        },
      });

      const runtime = await run(app);
      const queue = runtime.value.map.get("idle-failure");
      if (!queue) {
        throw genericError.new({
          message: "Expected idle-failure queue to exist",
        });
      }

      queue.dispose = jest
        .fn()
        .mockRejectedValue(new Error("idle teardown failed"));

      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      expect(queue.dispose).toHaveBeenCalledTimes(1);
      expect(runtime.value.map.has("idle-failure")).toBe(false);

      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});
