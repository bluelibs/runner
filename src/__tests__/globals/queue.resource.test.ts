import { defineResource } from "../../define";
import { run } from "../../run";
import { queueResource } from "../../globals/resources/queue.resource";
import { createMessageError } from "../../errors";

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
          throw createMessageError("Task failed");
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
          throw createMessageError("Queue resource task error");
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
});
