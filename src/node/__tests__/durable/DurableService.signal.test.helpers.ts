import { defineEvent } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import type { Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import {
  createBareStore,
  SpyQueue,
  sleepingExecution,
} from "./DurableService.unit.helpers";

export const Paid = defineEvent<{ paidAt: number }>({ id: "paid" });
export const Timed = defineEvent<{ paidAt: number }>({ id: "timed" });
export const X = defineEvent<unknown>({ id: "x" });

export type SignalSetupOptions = {
  queue?: boolean;
  audit?: boolean;
  seedExecution?: boolean;
  executionId?: string;
  executionOverrides?: Partial<Execution>;
  storeOverrides?: Partial<IDurableStore>;
};

export async function signalSetup(opts?: SignalSetupOptions) {
  const base = new MemoryStore();
  const queue = opts?.queue !== false ? new SpyQueue() : undefined;
  const store = opts?.storeOverrides
    ? createBareStore(base, opts.storeOverrides)
    : base;

  const service = new DurableService({
    store,
    queue,
    tasks: [],
    ...(opts?.audit ? { audit: { enabled: true } } : {}),
  });

  const execId = opts?.executionId ?? "e1";
  if (opts?.seedExecution !== false) {
    await base.saveExecution(
      sleepingExecution({ id: execId, ...opts?.executionOverrides }),
    );
  }

  return { base, store, queue, service, execId };
}
