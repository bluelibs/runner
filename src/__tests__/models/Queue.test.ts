// queue.test.ts
import { Queue } from "../.."; // <-- adjust path if needed

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Flush native micro‑tasks once (Promise jobs / process.nextTick). */
const flushMicroTasks = () => Promise.resolve();

/** Small delay helper for tests */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Queue", () => {
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
      await delay(1);

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

    await expect(q.run(deadlock)).rejects.toThrow(/Dead‑lock/);
  });

  it("dispose() drains pending tasks and rejects new ones", async () => {
    const q = new Queue();

    const task = async () => {
      await delay(1);
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
    jest.useFakeTimers();

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

    jest.useRealTimers();
  });

  it("dispose() is idempotent - multiple calls should be safe", async () => {
    const q = new Queue();

    const task = async () => {
      await delay(1);
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
      new Error("Simulated tail rejection")
    );
    (q as any).tail = rejectingPromise;

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
      await delay(1);
      throw new Error("Task exception");
    };

    const successTask = async () => {
      await delay(1);
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
});
