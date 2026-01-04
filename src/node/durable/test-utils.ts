import type { DurableResourceRuntimeConfig } from "./core/resource";
import { durableResource } from "./core/resource";
import { MemoryEventBus } from "./bus/MemoryEventBus";
import { MemoryQueue } from "./queue/MemoryQueue";
import { MemoryStore } from "./store/MemoryStore";

type DurableResource = ReturnType<typeof durableResource.fork>;
type DurableResourceRegistration = ReturnType<DurableResource["with"]>;

export interface DurableTestSetup {
  durable: DurableResource;
  durableRegistration: DurableResourceRegistration;
  store: MemoryStore;
  eventBus: MemoryEventBus;
  queue?: MemoryQueue;
}

export interface DurableTestSetupOptions {
  durableId?: string;
  store?: MemoryStore;
  eventBus?: MemoryEventBus;
  queue?: MemoryQueue;
  worker?: boolean;
  pollingIntervalMs?: number;
  durableConfig?: Partial<DurableResourceRuntimeConfig>;
}

export function createDurableTestSetup(
  options: DurableTestSetupOptions = {},
): DurableTestSetup {
  const store = options.store ?? new MemoryStore();
  const eventBus = options.eventBus ?? new MemoryEventBus();
  const queue = options.queue;
  const worker = options.worker ?? Boolean(queue);
  const pollingIntervalMs = options.pollingIntervalMs ?? 5;

  const durableConfigOverrides = options.durableConfig ?? {};
  const durableConfig: DurableResourceRuntimeConfig = {
    ...durableConfigOverrides,
    store,
    eventBus,
    queue,
    worker,
    polling: {
      interval: pollingIntervalMs,
      ...durableConfigOverrides.polling,
    },
  };

  const durable = durableResource.fork(options.durableId ?? "durable.tests.resource");
  const durableRegistration = durable.with(durableConfig);

  return {
    durable,
    durableRegistration,
    store,
    eventBus,
    queue,
  };
}

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
