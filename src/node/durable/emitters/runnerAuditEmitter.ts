import type { EventManager } from "../../../models/EventManager";
import type { DurableAuditEmitter, DurableAuditEntry } from "../core/audit";
import { durableEvents } from "../events";

export function createDurableRunnerAuditEmitter(params: {
  eventManager: EventManager;
  source?: string;
}): DurableAuditEmitter {
  const source = params.source ?? "durable.audit";
  const { eventManager } = params;

  return {
    emit: async (entry: DurableAuditEntry) => {
      await eventManager.emit(durableEvents.audit.appended, { entry }, source);

      switch (entry.kind) {
        case "execution_status_changed":
          await eventManager.emit(
            durableEvents.execution.statusChanged,
            entry,
            source,
          );
          return;
        case "step_completed":
          await eventManager.emit(durableEvents.step.completed, entry, source);
          return;
        case "sleep_scheduled":
          await eventManager.emit(durableEvents.sleep.scheduled, entry, source);
          return;
        case "sleep_completed":
          await eventManager.emit(durableEvents.sleep.completed, entry, source);
          return;
        case "signal_waiting":
          await eventManager.emit(durableEvents.signal.waiting, entry, source);
          return;
        case "signal_delivered":
          await eventManager.emit(durableEvents.signal.delivered, entry, source);
          return;
        case "signal_timed_out":
          await eventManager.emit(durableEvents.signal.timedOut, entry, source);
          return;
        case "emit_published":
          await eventManager.emit(durableEvents.emit.published, entry, source);
          return;
        case "note":
          await eventManager.emit(durableEvents.note.created, entry, source);
          return;
      }
    },
  };
}
