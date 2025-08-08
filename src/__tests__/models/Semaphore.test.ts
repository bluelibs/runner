import { Semaphore } from "../..";

describe("Semaphore", () => {
  let semaphore: Semaphore;

  beforeEach(() => {
    semaphore = new Semaphore(2);
  });

  afterEach(() => {
    if (!semaphore.isDisposed()) {
      semaphore.dispose();
    }
  });

  describe("constructor", () => {
    it("should create semaphore with valid maxPermits", () => {
      const sem = new Semaphore(5);
      expect(sem.getMaxPermits()).toBe(5);
      expect(sem.getAvailablePermits()).toBe(5);
      expect(sem.getWaitingCount()).toBe(0);
      expect(sem.isDisposed()).toBe(false);
      sem.dispose();
    });

    it("should throw error for invalid maxPermits", () => {
      expect(() => new Semaphore(0)).toThrow(
        "maxPermits must be greater than 0"
      );
      expect(() => new Semaphore(-1)).toThrow(
        "maxPermits must be greater than 0"
      );
    });
  });

  describe("acquire and release", () => {
    it("should acquire permits when available", async () => {
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(1);

      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(0);
    });

    it("should release permits correctly", async () => {
      await semaphore.acquire();
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(0);

      semaphore.release();
      expect(semaphore.getAvailablePermits()).toBe(1);

      semaphore.release();
      expect(semaphore.getAvailablePermits()).toBe(2);
    });

    it("should not exceed max permits on release", () => {
      // Release without acquire should not exceed max
      semaphore.release();
      expect(semaphore.getAvailablePermits()).toBe(2); // Should stay at max
    });

    it("should queue operations when no permits available", async () => {
      // Fill up all permits
      await semaphore.acquire();
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(0);

      // Start a third operation that should wait
      const pendingOperation = semaphore.acquire();
      expect(semaphore.getWaitingCount()).toBe(1);

      // Release a permit - should resolve the waiting operation
      semaphore.release();
      await pendingOperation;
      expect(semaphore.getWaitingCount()).toBe(0);
      expect(semaphore.getAvailablePermits()).toBe(0); // Permit went directly to waiting operation
    });

    it("should handle multiple waiting operations in FIFO order", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const results: number[] = [];

      // Queue multiple operations
      const op1 = semaphore.acquire().then(() => results.push(1));
      const op2 = semaphore.acquire().then(() => results.push(2));
      const op3 = semaphore.acquire().then(() => results.push(3));

      expect(semaphore.getWaitingCount()).toBe(3);

      // Release permits one by one
      semaphore.release();
      await op1;
      expect(results).toEqual([1]);

      semaphore.release();
      await op2;
      expect(results).toEqual([1, 2]);

      semaphore.release();
      await op3;
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe("withPermit", () => {
    it("should execute function with permit and auto-release", async () => {
      let executed = false;
      const result = await semaphore.withPermit(async () => {
        executed = true;
        expect(semaphore.getAvailablePermits()).toBe(1); // One permit taken
        return "success";
      });

      expect(executed).toBe(true);
      expect(result).toBe("success");
      expect(semaphore.getAvailablePermits()).toBe(2); // Permit released
    });

    it("should release permit even if function throws", async () => {
      expect.assertions(2);

      try {
        await semaphore.withPermit(async () => {
          expect(semaphore.getAvailablePermits()).toBe(1);
          throw new Error("Test error");
        });
      } catch (error) {
        expect(semaphore.getAvailablePermits()).toBe(2); // Permit still released
      }
    });

    it("should queue withPermit operations when no permits available", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const results: string[] = [];

      // Queue operations
      const op1 = semaphore.withPermit(async () => {
        results.push("op1");
        return "result1";
      });

      const op2 = semaphore.withPermit(async () => {
        results.push("op2");
        return "result2";
      });

      expect(semaphore.getWaitingCount()).toBe(2);

      // Release permits
      semaphore.release();
      await op1;
      expect(results).toEqual(["op1"]);

      semaphore.release();
      await op2;
      expect(results).toEqual(["op1", "op2"]);
    });
  });

  describe("timeout support", () => {
    it("should timeout acquire operation", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const startTime = Date.now();

      await expect(semaphore.acquire({ timeout: 100 })).rejects.toThrow(
        "Semaphore acquire timeout after 100ms"
      );

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(300); // Should not wait much longer
    });

    it("should timeout withPermit operation", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      await expect(
        semaphore.withPermit(async () => "never executed", { timeout: 100 })
      ).rejects.toThrow("Semaphore acquire timeout after 100ms");
    });

    it("should clear timeout when operation succeeds", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Start operation with timeout
      const operationPromise = semaphore.acquire({ timeout: 1000 });

      // Release permit quickly - should not timeout
      setTimeout(() => semaphore.release(), 50);

      await expect(operationPromise).resolves.toBeUndefined();
    });

    it("should handle zero or negative timeout", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Zero timeout should be ignored
      const operationPromise = semaphore.acquire({ timeout: 0 });
      semaphore.release();
      await expect(operationPromise).resolves.toBeUndefined();
    });

    it("should remove timed out operations from queue", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Start operation that will timeout
      const timeoutPromise = semaphore.acquire({ timeout: 50 });
      expect(semaphore.getWaitingCount()).toBe(1);

      await expect(timeoutPromise).rejects.toThrow("timeout");
      expect(semaphore.getWaitingCount()).toBe(0);
    });
  });

  describe("cancellation support", () => {
    it("should cancel acquire operation with AbortSignal", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();
      const operationPromise = semaphore.acquire({ signal: controller.signal });

      expect(semaphore.getWaitingCount()).toBe(1);

      // Cancel the operation
      controller.abort();

      await expect(operationPromise).rejects.toThrow("Operation was aborted");
      expect(semaphore.getWaitingCount()).toBe(0);
    });

    it("should cancel withPermit operation with AbortSignal", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();
      const operationPromise = semaphore.withPermit(
        async () => "never executed",
        { signal: controller.signal }
      );

      controller.abort();

      await expect(operationPromise).rejects.toThrow("Operation was aborted");
    });

    it("should reject immediately if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        semaphore.acquire({ signal: controller.signal })
      ).rejects.toThrow("Operation was aborted");
    });

    it("should clean up abort listeners when operation completes normally", async () => {
      const controller = new AbortController();

      // This should complete normally and clean up listeners
      await semaphore.acquire({ signal: controller.signal });
      semaphore.release();

      // No way to directly test listener cleanup, but this ensures no memory leaks
      expect(semaphore.getAvailablePermits()).toBe(2);
    });

    it("should clean up abort listeners when queued operation resolves", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();

      // Start operation that will wait in queue
      const queuedOperation = semaphore.acquire({ signal: controller.signal });
      expect(semaphore.getWaitingCount()).toBe(1);

      // Release permit - should trigger the resolve path with cleanup
      semaphore.release();
      await queuedOperation;

      expect(semaphore.getWaitingCount()).toBe(0);
      expect(semaphore.getAvailablePermits()).toBe(0);
    });

    it("should clean up abort listeners when queued operation rejects due to timeout", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();

      // Start operation with both timeout and abort signal
      const queuedOperation = semaphore.acquire({
        timeout: 50,
        signal: controller.signal,
      });
      expect(semaphore.getWaitingCount()).toBe(1);

      // Let timeout occur - should trigger reject path with cleanup
      await expect(queuedOperation).rejects.toThrow("timeout");

      expect(semaphore.getWaitingCount()).toBe(0);
    });

    it("should handle both timeout and cancellation", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();
      const operationPromise = semaphore.acquire({
        timeout: 1000,
        signal: controller.signal,
      });

      // Cancel before timeout
      setTimeout(() => controller.abort(), 50);

      await expect(operationPromise).rejects.toThrow("Operation was aborted");
    });
  });

  describe("dispose", () => {
    it("should dispose semaphore and reject waiting operations", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Queue some operations
      const op1 = semaphore.acquire();
      const op2 = semaphore.acquire();
      const op3 = semaphore.withPermit(async () => "never executed");

      expect(semaphore.getWaitingCount()).toBe(3);

      // Dispose
      semaphore.dispose();

      // All operations should be rejected
      await expect(op1).rejects.toThrow("Semaphore has been disposed");
      await expect(op2).rejects.toThrow("Semaphore has been disposed");
      await expect(op3).rejects.toThrow("Semaphore has been disposed");

      expect(semaphore.getWaitingCount()).toBe(0);
      expect(semaphore.isDisposed()).toBe(true);
    });

    it("should prevent new operations after disposal", async () => {
      semaphore.dispose();

      await expect(semaphore.acquire()).rejects.toThrow(
        "Semaphore has been disposed"
      );
      await expect(
        semaphore.withPermit(async () => "never executed")
      ).rejects.toThrow("Semaphore has been disposed");
    });

    it("should ignore release after disposal", () => {
      semaphore.dispose();

      // Should not throw
      semaphore.release();
      expect(semaphore.isDisposed()).toBe(true);
    });

    it("should be idempotent", () => {
      semaphore.dispose();
      semaphore.dispose();
      semaphore.dispose();

      expect(semaphore.isDisposed()).toBe(true);
    });

    it("should clear timeouts when disposing", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Start operation with timeout
      const operationPromise = semaphore.acquire({ timeout: 1000 });

      // Dispose immediately - should not wait for timeout
      semaphore.dispose();

      await expect(operationPromise).rejects.toThrow(
        "Semaphore has been disposed"
      );
    });

    it("should clean up abort listeners when operation is disposed", async () => {
      // Fill all permits
      await semaphore.acquire();
      await semaphore.acquire();

      const controller = new AbortController();

      // Start operation with abort signal that will wait in queue
      const queuedOperation = semaphore.acquire({ signal: controller.signal });
      expect(semaphore.getWaitingCount()).toBe(1);

      // Dispose semaphore - should trigger reject path with abort listener cleanup
      semaphore.dispose();

      await expect(queuedOperation).rejects.toThrow(
        "Semaphore has been disposed"
      );

      expect(semaphore.getWaitingCount()).toBe(0);
    });
  });

  describe("metrics and debugging", () => {
    it("should provide accurate metrics", () => {
      const metrics = semaphore.getMetrics();

      expect(metrics.availablePermits).toBe(2);
      expect(metrics.waitingCount).toBe(0);
      expect(metrics.maxPermits).toBe(2);
      expect(metrics.utilization).toBe(0);
      expect(metrics.disposed).toBe(false);
    });

    it("should update metrics as operations progress", async () => {
      // Acquire one permit
      await semaphore.acquire();

      let metrics = semaphore.getMetrics();
      expect(metrics.availablePermits).toBe(1);
      expect(metrics.utilization).toBe(0.5);

      // Acquire second permit
      await semaphore.acquire();

      metrics = semaphore.getMetrics();
      expect(metrics.availablePermits).toBe(0);
      expect(metrics.utilization).toBe(1);

      // Queue an operation
      const pendingOp = semaphore.acquire();

      metrics = semaphore.getMetrics();
      expect(metrics.waitingCount).toBe(1);

      // Release and complete
      semaphore.release();
      await pendingOp;

      metrics = semaphore.getMetrics();
      expect(metrics.availablePermits).toBe(0);
      expect(metrics.waitingCount).toBe(0);
      expect(metrics.utilization).toBe(1);
    });

    it("should provide individual metric getters", async () => {
      expect(semaphore.getAvailablePermits()).toBe(2);
      expect(semaphore.getWaitingCount()).toBe(0);
      expect(semaphore.getMaxPermits()).toBe(2);
      expect(semaphore.isDisposed()).toBe(false);

      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(1);

      // Queue an operation
      await semaphore.acquire();
      const pendingOp = semaphore.acquire();
      expect(semaphore.getWaitingCount()).toBe(1);

      semaphore.dispose();
      expect(semaphore.isDisposed()).toBe(true);

      await expect(pendingOp).rejects.toThrow();
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle rapid acquire/release cycles", async () => {
      const operations: any[] = [];

      // Rapid fire operations
      for (let i = 0; i < 100; i++) {
        operations.push(
          semaphore.withPermit(async () => {
            // Simulate quick work
            await new Promise((resolve) => setTimeout(resolve, 1));
            return i;
          })
        );
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(100);
      expect(semaphore.getAvailablePermits()).toBe(2);
      expect(semaphore.getWaitingCount()).toBe(0);
    });

    it("should handle concurrent dispose and operations", async () => {
      // Fill permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Start multiple operations
      const operations = [
        semaphore.acquire(),
        semaphore.acquire(),
        semaphore.withPermit(async () => "test"),
      ];

      // Dispose concurrently
      setTimeout(() => semaphore.dispose(), 10);

      // All should be rejected
      for (const op of operations) {
        await expect(op).rejects.toThrow("Semaphore has been disposed");
      }
    });

    it("should handle mixed timeout and non-timeout operations", async () => {
      // Fill permits
      await semaphore.acquire();
      await semaphore.acquire();

      // Mix of operations
      const op1 = semaphore.acquire(); // No timeout
      const op2 = semaphore.acquire({ timeout: 100 }); // Will timeout
      const op3 = semaphore.acquire(); // No timeout

      expect(semaphore.getWaitingCount()).toBe(3);

      // Wait for timeout
      await expect(op2).rejects.toThrow("timeout");
      expect(semaphore.getWaitingCount()).toBe(2);

      // Release permits for remaining operations
      semaphore.release();
      await op1;
      semaphore.release();
      await op3;
    });

    it("should maintain consistency under stress", async () => {
      const concurrentOps = 50;
      const operations: any[] = [];

      // Start many concurrent operations
      for (let i = 0; i < concurrentOps; i++) {
        operations.push(
          semaphore.withPermit(async () => {
            // Random delay to create timing variations
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 10)
            );
            return i;
          })
        );
      }

      const results = await Promise.all(operations);

      // Verify all operations completed
      expect(results).toHaveLength(concurrentOps);
      expect(semaphore.getAvailablePermits()).toBe(2);
      expect(semaphore.getWaitingCount()).toBe(0);
    });
  });

  describe("real-world scenarios", () => {
    it("should work as database connection pool limiter", async () => {
      const dbSemaphore = new Semaphore(3);
      const connectionPool = {
        activeConnections: 0,
        maxConnections: 3,
        async query(sql: string) {
          return dbSemaphore.withPermit(async () => {
            this.activeConnections++;
            expect(this.activeConnections).toBeLessThanOrEqual(
              this.maxConnections
            );

            // Simulate query time
            await new Promise((resolve) => setTimeout(resolve, 10));

            this.activeConnections--;
            return `Result for: ${sql}`;
          });
        },
      };

      // Fire many concurrent queries
      const queries = Array.from({ length: 10 }, (_, i) =>
        connectionPool.query(`SELECT * FROM users WHERE id = ${i}`)
      );

      const results = await Promise.all(queries);
      expect(results).toHaveLength(10);
      expect(connectionPool.activeConnections).toBe(0);

      dbSemaphore.dispose();
    });

    it("should work as rate limiter for API calls", async () => {
      const rateLimiter = new Semaphore(2);
      let activeCalls = 0;

      const apiClient = {
        async fetchUser(id: number, signal?: AbortSignal) {
          return rateLimiter.withPermit(
            async () => {
              activeCalls++;
              expect(activeCalls).toBeLessThanOrEqual(2);

              // Simulate API call
              await new Promise((resolve) => setTimeout(resolve, 20));

              activeCalls--;
              return { id, name: `User ${id}` };
            },
            { signal }
          );
        },
      };

      // Test normal operation
      const users = await Promise.all([
        apiClient.fetchUser(1),
        apiClient.fetchUser(2),
        apiClient.fetchUser(3),
        apiClient.fetchUser(4),
      ]);

      expect(users).toHaveLength(4);
      expect(activeCalls).toBe(0);

      // Test with cancellation - start long-running operations to fill semaphore
      const longRunningOp1 = apiClient.fetchUser(10);
      const longRunningOp2 = apiClient.fetchUser(11);

      // Now semaphore should be full, so next operation will wait
      const controller = new AbortController();
      const cancelledCall = apiClient.fetchUser(5, controller.signal);
      controller.abort();

      await expect(cancelledCall).rejects.toThrow("Operation was aborted");

      // Wait for the long-running operations to complete
      await longRunningOp1;
      await longRunningOp2;

      rateLimiter.dispose();
    });

    it("should handle batch processing with progress tracking", async () => {
      const batchSemaphore = new Semaphore(3);
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        data: `item-${i}`,
      }));
      const processed: any[] = [];

      const processBatch = async () => {
        const promises = items.map((item) =>
          batchSemaphore.withPermit(async () => {
            // Simulate processing time
            await new Promise((resolve) => setTimeout(resolve, 5));

            const result = { ...item, processed: true };
            processed.push(result);

            // Track progress
            const metrics = batchSemaphore.getMetrics();
            expect(
              metrics.maxPermits - metrics.availablePermits
            ).toBeLessThanOrEqual(3);

            return result;
          })
        );

        return Promise.all(promises);
      };

      const results = await processBatch();

      expect(results).toHaveLength(20);
      expect(processed).toHaveLength(20);
      expect(batchSemaphore.getAvailablePermits()).toBe(3);
      expect(batchSemaphore.getWaitingCount()).toBe(0);

      batchSemaphore.dispose();
    });
  });
});
