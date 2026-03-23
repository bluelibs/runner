import {
  DurableService,
  initDurableService,
} from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: DurableService init failure cleanup", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("disposes initialized adapters when recovery startup fails", async () => {
    class StoreWithoutLocks extends MemoryStore {
      constructor(
        public readonly initFn: () => Promise<void>,
        public readonly disposeFn: () => Promise<void>,
      ) {
        super();
      }

      init() {
        return this.initFn();
      }

      dispose() {
        return this.disposeFn();
      }
    }

    const initStore = jest.fn(async () => {});
    const disposeStore = jest.fn(async () => {});
    const store = new StoreWithoutLocks(initStore, disposeStore) as MemoryStore;
    Object.defineProperty(store, "acquireLock", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(store, "releaseLock", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const queue = {
      enqueue: jest.fn(async () => "m1"),
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {}),
    };
    const eventBus = {
      publish: jest.fn(async () => {}),
      subscribe: jest.fn(async () => {}),
      unsubscribe: jest.fn(async () => {}),
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {}),
    };
    const startSpy = jest.spyOn(DurableService.prototype, "start");

    await expect(
      initDurableService({
        store,
        queue,
        eventBus,
        recovery: { onStartup: true },
      }),
    ).rejects.toThrow("Durable recovery requires store-level locking");

    expect(initStore).toHaveBeenCalledTimes(1);
    expect(queue.init).toHaveBeenCalledTimes(1);
    expect(eventBus.init).toHaveBeenCalledTimes(1);
    expect(eventBus.dispose).toHaveBeenCalledTimes(1);
    expect(queue.dispose).toHaveBeenCalledTimes(1);
    expect(disposeStore).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("swallows cleanup errors and rethrows the original startup failure", async () => {
    const startupError = new Error("recovery-start-failed");
    const stopError = new Error("stop-failed");
    const eventBusDisposeError = new Error("event-bus-dispose-failed");
    const queueDisposeError = new Error("queue-dispose-failed");
    const storeDisposeError = new Error("store-dispose-failed");
    const stopSpy = jest
      .spyOn(DurableService.prototype, "stop")
      .mockRejectedValue(stopError);
    const startRecoverySpy = jest
      .spyOn(DurableService.prototype, "startRecoveryOnInit")
      .mockImplementation(() => {
        throw startupError;
      });

    const store = new MemoryStore() as MemoryStore & {
      init?: () => Promise<void>;
      dispose?: () => Promise<void>;
    };
    store.init = jest.fn(async () => {});
    store.dispose = jest.fn(async () => {
      throw storeDisposeError;
    });

    const queue = {
      enqueue: jest.fn(async () => "m1"),
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {
        throw queueDisposeError;
      }),
    };
    const eventBus = {
      publish: jest.fn(async () => {}),
      subscribe: jest.fn(async () => {}),
      unsubscribe: jest.fn(async () => {}),
      init: jest.fn(async () => {}),
      dispose: jest.fn(async () => {
        throw eventBusDisposeError;
      }),
    };

    await expect(
      initDurableService({
        store,
        queue,
        eventBus,
        recovery: { onStartup: true },
      }),
    ).rejects.toThrow(startupError.message);

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(eventBus.dispose).toHaveBeenCalledTimes(1);
    expect(queue.dispose).toHaveBeenCalledTimes(1);
    expect(store.dispose).toHaveBeenCalledTimes(1);
    expect(startRecoverySpy).toHaveBeenCalledTimes(1);
  });
});
