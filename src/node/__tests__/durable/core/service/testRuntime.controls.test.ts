import { r, resources } from "../../../..";
import { createDurableTestRuntime } from "../../../../durable/test-runtime";
import { DurableService } from "../../../../durable/core/DurableService";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";

describe("isolated test runtime controls", () => {
  it("requires a started runtime, validates time, and waits for live ownership before restarting", async () => {
    const test = createDurableTestRuntime({ now: new Date(100) });
    expect(() => test.backend).toThrow("test.run");
    await expect(test.advanceTimeBy(1)).rejects.toThrow("test.run");
    await test.dispose();
    const app = r
      .resource("app")
      .register([resources.durable, test.durableRegistration])
      .build();
    await test.run(app, { logs: { printThreshold: null } });
    try {
      await expect(test.run(app)).rejects.toThrow("already running");
      for (const duration of [-1, Infinity, NaN])
        await expect(test.advanceTimeBy(duration)).rejects.toThrow(
          "finite, nonnegative",
        );
      await test.store.saveExecution(pendingExecution({ id: "active" }));
      const lock = await test.store.acquireLock("execution:active", 30000);
      await expect(test.restartWorker()).rejects.toThrow("active callbacks");
      await test.store.releaseLock("execution:active", lock!);
      const service = test.backend.service;
      Object.defineProperty(test.backend, "service", {
        configurable: true,
        value: {},
      });
      await expect(test.advanceTimeBy(0)).rejects.toThrow(
        "built-in durable service",
      );
      Object.defineProperty(test.backend, "service", { value: service });
      expect(service).toBeInstanceOf(DurableService);
    } finally {
      await test.dispose();
    }
  });

  it("bounds a timer loop instead of hanging the test process", async () => {
    const test = createDurableTestRuntime();
    await test.run(
      r
        .resource("app")
        .register([resources.durable, test.durableRegistration])
        .build(),
      { logs: { printThreshold: null } },
    );
    try {
      jest.spyOn(test.store, "getReadyTimers").mockResolvedValue([
        {
          id: "loop",
          fireAt: new Date(0),
          type: "retry",
          status: "pending",
          executionId: "none",
        },
      ]);
      await expect(test.advanceTimeBy(1)).rejects.toThrow("timer limit");
    } finally {
      jest.restoreAllMocks();
      await test.dispose();
    }
  });
});
