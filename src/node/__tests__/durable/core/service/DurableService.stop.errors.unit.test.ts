import {
  disposeDurableService,
  DurableService,
} from "../../../../durable/core/DurableService";
import type { DurableServiceConfig } from "../../../../durable/core/interfaces/service";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";
import { Logger } from "../../../../../models/Logger";

describe("durable: DurableService stop errors", () => {
  it("logs polling shutdown failures before rethrowing them", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const service = new DurableService({ store, tasks: [], logger });
    const pollingError = genericError.new({ message: "polling-stop-failed" });
    const loggerError = jest
      .spyOn((service as unknown as { logger: Logger }).logger, "error")
      .mockResolvedValue();

    (
      service as unknown as {
        pollingManager: { stop: () => Promise<void> };
      }
    ).pollingManager.stop = jest.fn(async () => {
      throw pollingError;
    });

    await expect(service.stop()).rejects.toThrow("polling-stop-failed");
    expect(loggerError).toHaveBeenCalledWith(
      "Durable polling shutdown failed.",
      { error: pollingError },
    );
  });

  it("finishes the stop phase after cooldown errors before rethrowing", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const service = new DurableService({ store, tasks: [], logger });
    const cooldownError = genericError.new({ message: "cooldown-failed" });
    const stopHandler = jest.fn(async () => {});
    const pollingStop = jest.fn(async () => {});

    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        stopHandlers: Array<() => Promise<void>>;
        pollingManager: { stop: () => Promise<void> };
      }
    ).cooldownHandlers.push(async () => {
      throw cooldownError;
    });
    (
      service as unknown as {
        cooldownHandlers: Array<() => Promise<void>>;
        stopHandlers: Array<() => Promise<void>>;
        pollingManager: { stop: () => Promise<void> };
      }
    ).stopHandlers.push(stopHandler);
    (
      service as unknown as {
        pollingManager: { stop: () => Promise<void> };
      }
    ).pollingManager.stop = pollingStop;

    await expect(service.stop()).rejects.toThrow("cooldown-failed");

    expect(stopHandler).toHaveBeenCalledTimes(1);
    expect(pollingStop).toHaveBeenCalledTimes(1);
    expect(
      (
        service as unknown as {
          lifecycleState: string;
        }
      ).lifecycleState,
    ).toBe("disposed");
  });

  it("does not dispose adapters when service.stop() rejects", async () => {
    const stopError = genericError.new({ message: "stop-failed" });
    const service = {
      stop: jest.fn(async () => {
        throw stopError;
      }),
    } as unknown as DurableService;
    const storeDispose = jest.fn(async () => {});
    const queueDispose = jest.fn(async () => {});
    const eventBusDispose = jest.fn(async () => {});

    await expect(
      disposeDurableService(service, {
        store: { dispose: storeDispose },
        queue: { dispose: queueDispose },
        eventBus: { dispose: eventBusDispose },
      } as unknown as DurableServiceConfig),
    ).rejects.toThrow("stop-failed");

    expect(storeDispose).not.toHaveBeenCalled();
    expect(queueDispose).not.toHaveBeenCalled();
    expect(eventBusDispose).not.toHaveBeenCalled();
  });

  it("short-circuits adapter disposal after stop failures", async () => {
    const stopError = genericError.new({ message: "stop-failed" });
    const storeDisposeError = genericError.new({
      message: "store-dispose-failed",
    });
    const queueDisposeError = genericError.new({
      message: "queue-dispose-failed",
    });
    const eventBusDisposeError = genericError.new({
      message: "eventbus-dispose-failed",
    });
    const service = {
      stop: jest.fn(async () => {
        throw stopError;
      }),
    } as unknown as DurableService;
    const storeDispose = jest.fn(async () => {
      throw storeDisposeError;
    });
    const queueDispose = jest.fn(async () => {
      throw queueDisposeError;
    });
    const eventBusDispose = jest.fn(async () => {
      throw eventBusDisposeError;
    });

    await expect(
      disposeDurableService(service, {
        store: { dispose: storeDispose },
        queue: { dispose: queueDispose },
        eventBus: { dispose: eventBusDispose },
      } as unknown as DurableServiceConfig),
    ).rejects.toThrow("stop-failed");

    expect(storeDispose).not.toHaveBeenCalled();
    expect(queueDispose).not.toHaveBeenCalled();
    expect(eventBusDispose).not.toHaveBeenCalled();
  });

  it("rethrows store disposal failures when stop succeeds", async () => {
    const storeDisposeError = genericError.new({
      message: "store-dispose-failed",
    });
    const service = {
      stop: jest.fn(async () => {}),
    } as unknown as DurableService;

    await expect(
      disposeDurableService(service, {
        store: {
          dispose: jest.fn(async () => {
            throw storeDisposeError;
          }),
        },
      } as unknown as DurableServiceConfig),
    ).rejects.toThrow("store-dispose-failed");
  });

  it("rethrows queue disposal failures when earlier cleanup succeeds", async () => {
    const queueDisposeError = genericError.new({
      message: "queue-dispose-failed",
    });
    const service = {
      stop: jest.fn(async () => {}),
    } as unknown as DurableService;

    await expect(
      disposeDurableService(service, {
        store: {
          dispose: jest.fn(async () => {}),
        },
        queue: {
          dispose: jest.fn(async () => {
            throw queueDisposeError;
          }),
        },
      } as unknown as DurableServiceConfig),
    ).rejects.toThrow("queue-dispose-failed");
  });

  it("rethrows event bus disposal failures when earlier cleanup succeeds", async () => {
    const eventBusDisposeError = genericError.new({
      message: "eventbus-dispose-failed",
    });
    const service = {
      stop: jest.fn(async () => {}),
    } as unknown as DurableService;

    await expect(
      disposeDurableService(service, {
        store: {
          dispose: jest.fn(async () => {}),
        },
        queue: {
          dispose: jest.fn(async () => {}),
        },
        eventBus: {
          dispose: jest.fn(async () => {
            throw eventBusDisposeError;
          }),
        },
      } as unknown as DurableServiceConfig),
    ).rejects.toThrow("eventbus-dispose-failed");
  });
});
