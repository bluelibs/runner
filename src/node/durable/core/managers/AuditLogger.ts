import type { IDurableStore } from "../interfaces/store";
import type { DurableAuditEntryInput, DurableAuditEmitter, DurableAuditEntry } from "../audit";
import { createDurableAuditEntryId } from "../audit";

export interface AuditConfig {
  /**
   * When enabled, attempts to persist audit entries to the store (if supported).
   * This is separate from event emission via `emitter`.
   */
  enabled?: boolean;
  /**
   * Optional emitter for streaming audit entries (e.g. Runner events, logging, mirroring).
   * Emissions must be best-effort and never affect workflow correctness.
   */
  emitter?: DurableAuditEmitter;
}

/**
 * Handles audit trail logging for durable workflows.
 * Gracefully degrades if audit persistence fails.
 */
export class AuditLogger {
  constructor(
    private readonly config: AuditConfig,
    private readonly store: IDurableStore,
  ) {}

  async log(params: DurableAuditEntryInput & { at?: Date }): Promise<void> {
    const shouldPersist = this.config.enabled === true && !!this.store.appendAuditEntry;
    const shouldEmit = !!this.config.emitter;
    if (!shouldPersist && !shouldEmit) return;

    const at = params.at ?? new Date();
    const fullEntry = {
      ...params,
      id: createDurableAuditEntryId(at.getTime()),
      at,
    } as DurableAuditEntry;

    if (shouldPersist) {
      try {
        await this.store.appendAuditEntry!(fullEntry);
      } catch {
        // Audit persistence must not affect workflow correctness.
      }
    }

    if (this.config.emitter) {
      try {
        await this.config.emitter.emit(fullEntry);
      } catch {
        // Audit emissions must not affect workflow correctness.
      }
    }
  }
}
