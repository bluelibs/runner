import { Logger } from "../../../models/Logger";
import { AuditLogger } from "../../durable/core/managers/AuditLogger";
import {
  handleSignalTimeoutTimer,
  handleSleepTimer,
} from "../../durable/core/managers/PollingManager.timerHandlers";
import { TimerType } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: PollingManager timer handlers (unit)", () => {
  it("ignores non-sleep or incomplete sleep timers", async () => {
    const store = new MemoryStore();
    const auditLogger = new AuditLogger({}, store);

    await expect(
      handleSleepTimer({
        store,
        auditLogger,
        timer: {
          id: "retry:1",
          type: TimerType.Retry,
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      handleSleepTimer({
        store,
        auditLogger,
        timer: {
          id: "sleep:missing-execution",
          type: TimerType.Sleep,
          stepId: "sleep:1",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores non-timeout or incomplete signal-timeout timers", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    await expect(
      handleSignalTimeoutTimer({
        store,
        logger,
        timer: {
          id: "sleep:1",
          type: TimerType.Sleep,
          executionId: "e1",
          stepId: "__signal:paid",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeNull();

    await expect(
      handleSignalTimeoutTimer({
        store,
        logger,
        timer: {
          id: "signal-timeout:missing-step",
          type: TimerType.SignalTimeout,
          executionId: "e1",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeNull();
  });
});
