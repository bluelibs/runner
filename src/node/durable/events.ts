import { globals, r } from "../../index";
import type { IEvent } from "../../defs";
import type { DurableAuditEntry } from "./core/audit";

const systemTag = globals.tags.system;
const excludeFromGlobalHooksTag = globals.tags.excludeFromGlobalHooks;

export const durableEvents = {
  audit: {
    appended: r
      .event<{ entry: DurableAuditEntry }>("durable.audit.appended")
      .meta({
        title: "Durable Audit Appended",
        description:
          "Emitted when a durable audit entry is produced (for logging/mirroring). Persistence depends on store support and audit configuration.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  execution: {
    statusChanged: r
      .event<Extract<DurableAuditEntry, { kind: "execution_status_changed" }>>(
        "durable.execution.statusChanged",
      )
      .meta({
        title: "Durable Execution Status Changed",
        description: "Emitted when a durable execution transitions status.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  step: {
    completed: r
      .event<Extract<DurableAuditEntry, { kind: "step_completed" }>>(
        "durable.step.completed",
      )
      .meta({
        title: "Durable Step Completed",
        description: "Emitted when a durable step is completed (including internals).",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  sleep: {
    scheduled: r
      .event<Extract<DurableAuditEntry, { kind: "sleep_scheduled" }>>(
        "durable.sleep.scheduled",
      )
      .meta({
        title: "Durable Sleep Scheduled",
        description: "Emitted when a durable sleep timer is scheduled.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),

    completed: r
      .event<Extract<DurableAuditEntry, { kind: "sleep_completed" }>>(
        "durable.sleep.completed",
      )
      .meta({
        title: "Durable Sleep Completed",
        description: "Emitted when a durable sleep timer fires and the step completes.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  signal: {
    waiting: r
      .event<Extract<DurableAuditEntry, { kind: "signal_waiting" }>>(
        "durable.signal.waiting",
      )
      .meta({
        title: "Durable Signal Waiting",
        description: "Emitted when a durable execution starts waiting for a signal.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),

    delivered: r
      .event<Extract<DurableAuditEntry, { kind: "signal_delivered" }>>(
        "durable.signal.delivered",
      )
      .meta({
        title: "Durable Signal Delivered",
        description: "Emitted when a signal payload is delivered to a waiting execution.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),

    timedOut: r
      .event<Extract<DurableAuditEntry, { kind: "signal_timed_out" }>>(
        "durable.signal.timedOut",
      )
      .meta({
        title: "Durable Signal Timed Out",
        description: "Emitted when a waiting signal times out.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  emit: {
    published: r
      .event<Extract<DurableAuditEntry, { kind: "emit_published" }>>(
        "durable.emit.published",
      )
      .meta({
        title: "Durable Emit Published",
        description:
          "Emitted when ctx.emit(...) publishes to the durable event bus (replay-safe).",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },

  note: {
    created: r
      .event<Extract<DurableAuditEntry, { kind: "note" }>>(
        "durable.note.created",
      )
      .meta({
        title: "Durable Note Created",
        description: "Emitted when ctx.note(...) records an audit note.",
      })
      .tags([systemTag, excludeFromGlobalHooksTag])
      .build(),
  },
} as const;

export const durableEventsArray: IEvent<any>[] = [
  durableEvents.audit.appended,
  durableEvents.execution.statusChanged,
  durableEvents.step.completed,
  durableEvents.sleep.scheduled,
  durableEvents.sleep.completed,
  durableEvents.signal.waiting,
  durableEvents.signal.delivered,
  durableEvents.signal.timedOut,
  durableEvents.emit.published,
  durableEvents.note.created,
];
