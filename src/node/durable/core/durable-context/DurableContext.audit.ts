import type { IDurableStore } from "../interfaces/store";
import {
  createDurableAuditEntryId,
  type DurableAuditEmitter,
  type DurableAuditEntry,
  type DurableAuditEntryInput,
} from "../audit";

export type DurableContextAudit = {
  /** True if we have at least one sink (store persistence and/or emitter). */
  isEnabled: () => boolean;
  append: (entry: DurableAuditEntryInput) => Promise<void>;
};

export function createDurableContextAudit(params: {
  store: IDurableStore;
  executionId: string;
  attempt: number;
  enabled: boolean;
  emitter: DurableAuditEmitter | null;
}): DurableContextAudit {
  const canPersist =
    params.enabled === true &&
    typeof params.store.appendAuditEntry === "function";
  const canEmit = params.emitter !== null;

  const isEnabled = (): boolean => canPersist || canEmit;

  const append = async (entry: DurableAuditEntryInput): Promise<void> => {
    if (!canPersist && !canEmit) return;

    const at = new Date();
    const fullEntry = {
      ...entry,
      id: createDurableAuditEntryId(at.getTime()),
      executionId: params.executionId,
      attempt: params.attempt,
      at,
    } as DurableAuditEntry;

    if (canPersist) {
      try {
        await params.store.appendAuditEntry!(fullEntry);
      } catch {
        // Audit persistence must not affect workflow correctness.
      }
    }

    if (params.emitter) {
      try {
        await params.emitter.emit(fullEntry);
      } catch {
        // Audit emissions must not affect workflow correctness.
      }
    }
  };

  return { isEnabled, append };
}
