// queue.test.ts
import { Queue } from "../.."; // <-- adjust path if needed

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Flush native micro‑tasks once (Promise jobs / process.nextTick). */
const flushMicroTasks = () => Promise.resolve();
import { createMessageError } from "../../errors";

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Queue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it("runs tasks sequentially and returns their results in order", async () => {
    const q = new Queue();

    const started: number[] = [];
    const finished: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const taskFactory = (id: number) => async () => {
      started.push(id);
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);

      // simulate async work with a real small delay
      jest.advanceTimersByTime(10);
      await Promise.resolve();

      finished.push(id);
      concurrent--;
      return id;
    };

    const p1 = q.run(taskFactory(1));
    const p2 = q.run(taskFactory(2));
    const p3 = q.run(taskFactory(3));

    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual([1, 2, 3]);
    expect(started).toEqual([1, 2, 3]);
    expect(finished).toEqual([1, 2, 3]);
    expect(maxConcurrent).toBe(1); // never overlapped
  });

  it("detects dead‑lock when a queued task enqueues another task", async () => {
    const q = new Queue();

    const deadlock = () => q.run(async () => "nested"); // <-- illegal

    await expect(q.run(deadlock)).rejects.toThrow(/Deadlock/);
  });

  it("dispose() drains pending tasks and rejects new ones", async () => {
    const q = new Queue();

    const task = async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      return "ok";
    };

    const p1 = q.run(task);
    const p2 = q.run(task);

    const disposeDone = q.dispose(); // default => { cancel: false }

    await expect(disposeDone).resolves.toBeUndefined();
    await expect(p1).resolves.toBe("ok");
    await expect(p2).resolves.toBe("ok");

    await expect(q.run(task)).rejects.toThrow(/disposed/);
  });

  it("dispose({ cancel: true }) aborts the running task", async () => {
    const q = new Queue();

    /** Long‑running task that cooperates with AbortSignal. */
    const longTask = async (signal: AbortSignal) =>
      new Promise<void>((_res, rej) => {
        const tid = setTimeout(_res, 100); // never actually fires
        signal.addEventListener("abort", () => {
          clearTimeout(tid);
          rej(new Error("aborted"));
        });
      });

    const p = q.run(longTask);

    // Let the task start
    jest.advanceTimersByTime(0);
    await flushMicroTasks();

    const disposeDone = q.dispose({ cancel: true });

    await flushMicroTasks(); // allow rejection to propagate

    await expect(p).rejects.toThrow(/aborted/);
    await expect(disposeDone).resolves.toBeUndefined();

    await expect(disposeDone).resolves.toBeUndefined();
  });

  it("dispose({ cancel: true }) skips queued tasks that did not start", async () => {
    const q = new Queue();
    let startedQueuedTask = false;

    const running = q.run(
      async (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    const queued = q.run(async () => {
      startedQueuedTask = true;
      return "should-not-run";
    });

    await flushMicroTasks();
    const disposeDone = q.dispose({ cancel: true });

    await expect(running).rejects.toThrow("aborted");
    await expect(queued).rejects.toThrow("Operation was aborted");
    expect(startedQueuedTask).toBe(false);
    await expect(disposeDone).resolves.toBeUndefined();
  });

  it("dispose() is idempotent - multiple calls should be safe", async () => {
    const q = new Queue();

    const task = async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      return "ok";
    };

    const p = q.run(task);

    // First dispose call
    const dispose1 = q.dispose();
    // Second dispose call should return immediately (if (this.disposed) return;)
    const dispose2 = q.dispose();
    // Third dispose call should also return immediately
    const dispose3 = q.dispose();

    await expect(dispose1).resolves.toBeUndefined();
    await expect(dispose2).resolves.toBeUndefined();
    await expect(dispose3).resolves.toBeUndefined();
    await expect(p).resolves.toBe("ok");

    // Further dispose calls after everything is settled should also be safe
    const dispose4 = q.dispose();
    await expect(dispose4).resolves.toBeUndefined();
  });

  it("dispose() properly handles rejected tail promises", async () => {
    const q = new Queue();

    // Run a task first to establish the normal tail chain
    await q.run(async () => "setup");

    // Directly set the tail to a promise that will reject
    // This simulates an internal error scenario where the tail becomes rejected
    const rejectingPromise = Promise.reject(
      new Error("Simulated tail rejection"),
    );
    // We cast to allow accessing private property for testing internal resilience
    (q as unknown as { tail: Promise<any> }).tail = rejectingPromise;

    // Spy on the rejecting promise to verify the catch is called
    const catchSpy = jest.spyOn(rejectingPromise, "catch");

    // The dispose method should handle this rejection with: await this.tail.catch(() => {})
    // This specifically tests the line: await this.tail.catch(() => {});
    await expect(q.dispose()).resolves.toBeUndefined();

    // Verify that the catch method was called (meaning the tail.catch() line was executed)
    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));

    // Verify the queue is properly disposed
    await expect(q.run(async () => "test")).rejects.toThrow(/disposed/);
  });

  it("should propagate task exceptions to the caller", async () => {
    const q = new Queue();

    // Test that exceptions are propagated, not swallowed
    const errorTask = async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      throw createMessageError("Task exception");
    };

    const successTask = async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      return "success";
    };

    // Exception should be catchable by the caller
    await expect(q.run(errorTask)).rejects.toThrow("Task exception");

    // Queue should still work for subsequent tasks
    await expect(q.run(successTask)).resolves.toBe("success");

    // Multiple exceptions should all be catchable
    await expect(q.run(errorTask)).rejects.toThrow("Task exception");
    await expect(q.run(errorTask)).rejects.toThrow("Task exception");
  });

  it("should work with other platforms than node", async () => {
    // This test is mostly to increase coverage on the platform checks
    // since we can't actually change the runtime environment in a test.

    // Create a Queue instance which will use the detected platform
    const q = new Queue();

    // We cast to access private / protected value
    (q as unknown as { hasAsyncLocalStorage: boolean }).hasAsyncLocalStorage =
      false;

    // Run a simple task to ensure basic functionality works
    const result = await q.run(async () => 3);
    expect(result).toBe(3);
  });

  it("emits queue events", async () => {
    const q = new Queue();
    const seen: string[] = [];

    q.on("enqueue", () => seen.push("enqueue"));
    q.on("start", () => seen.push("start"));
    q.on("finish", () => seen.push("finish"));
    q.on("error", () => seen.push("error"));
    q.on("cancel", () => seen.push("cancel"));
    q.on("disposed", () => seen.push("disposed"));

    await q.run(async () => "ok");
    await expect(
      q.run(async () => {
        throw createMessageError("boom");
      }),
    ).rejects.toThrow("boom");

    await q.dispose({ cancel: true });

    expect(seen).toEqual(
      expect.arrayContaining([
        "enqueue",
        "start",
        "finish",
        "error",
        "cancel",
        "disposed",
      ]),
    );
  });

  it("supports once listeners", async () => {
    const q = new Queue();
    const seen: string[] = [];

    q.once("finish", (event) => seen.push(event.type));

    await q.run(async () => "first");
    await q.run(async () => "second");

    expect(seen).toEqual(["finish"]);
  });

  it("supports unsubscribing from on() listeners", async () => {
    const q = new Queue();
    const seen: string[] = [];

    const unsubscribe = q.on("finish", () => seen.push("finish"));

    await q.run(async () => "first");
    expect(seen).toEqual(["finish"]);

    // Unsubscribe and verify no more events are received
    unsubscribe();

    await q.run(async () => "second");
    expect(seen).toEqual(["finish"]); // Still only one "finish"
  });

  it("supports unsubscribing from once() listeners before event fires", async () => {
    const q = new Queue();
    const seen: string[] = [];

    const unsubscribe = q.once("finish", () => seen.push("finish"));

    // Unsubscribe before any task runs
    unsubscribe();

    await q.run(async () => "first");
    expect(seen).toEqual([]); // No events received because we unsubscribed
  });

  it("hard-removes on() listeners from EventManager storage when unsubscribed", () => {
    const q = new Queue();
    const unsubscribe = q.on("finish", () => {});

    const listeners = (
      q as unknown as {
        eventManager: { registry: { listeners: Map<string, unknown[]> } };
      }
    ).eventManager.registry.listeners;
    expect(listeners.get("queue.events.finish")).toHaveLength(1);

    unsubscribe();

    expect(listeners.get("queue.events.finish")).toBeUndefined();
  });

  it("hard-removes once() listeners from EventManager storage after first fire", async () => {
    const q = new Queue();
    q.once("finish", () => {});

    const listeners = (
      q as unknown as {
        eventManager: { registry: { listeners: Map<string, unknown[]> } };
      }
    ).eventManager.registry.listeners;
    expect(listeners.get("queue.events.finish")).toHaveLength(1);

    await q.run(async () => "ok");
    await flushMicroTasks();

    expect(listeners.get("queue.events.finish")).toBeUndefined();
  });

  it("refreshes AbortController after dispose({ cancel: true })", async () => {
    const q = new Queue();
    const before = (q as unknown as { abortController: AbortController })
      .abortController;

    const running = q.run(
      async (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    await flushMicroTasks();
    await expect(q.dispose({ cancel: true })).resolves.toBeUndefined();
    await expect(running).rejects.toThrow("aborted");

    const after = (q as unknown as { abortController: AbortController })
      .abortController;
    expect(after).not.toBe(before);
    expect(after.signal.aborted).toBe(false);
  });
});
