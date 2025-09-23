import { defineResourceMiddleware } from "../../define";
import { globalTags } from "../globalTags";
import { globalResources } from "../globalResources";
import type { Store } from "../../models/Store";
import type { ITask, IEvent, IEventEmission } from "../../defs";
import type {
  TunnelRunner,
  TunnelTaskSelector,
  TunnelEventSelector,
} from "../resources/tunnel/types";
import { symbolTunneledTask } from "../../types/symbols";

const originalRuns = new WeakMap<
  ITask<any, any, any, any, any, any>,
  Function
>();

export const tunnelResourceMiddleware = defineResourceMiddleware<
  void,
  any,
  TunnelRunner,
  any
>({
  id: "globals.middleware.resource.tunnel",
  dependencies: {
    store: globalResources.store,
    eventManager: globalResources.eventManager,
  },
  // Only applies to resources tagged with globals.tags.tunnel
  everywhere: (resource) => globalTags.tunnel.exists(resource),
  run: async ({ resource, next }, { store, eventManager }) => {
    // Initialize the resource and get its value (tunnel runner)
    const value = (await next(resource.config)) as TunnelRunner;

    const mode = value.mode || "none";
    const delivery = value.eventDeliveryMode || "mirror";
    const tasks = value.tasks ? resolveTasks(store, value.tasks) : [];
    const events = value.events
      ? resolveEvents(store, value.events as any)
      : [];

    if (mode === "client" || mode === "both") {
      if (tasks.length > 0 && typeof value.run !== "function") {
        throw new Error(
          "Tunnel resource value must implement run(task, input) when tasks[] is configured.",
        );
      }
      if (events.length > 0 && typeof value.emit !== "function") {
        throw new Error(
          "Tunnel resource value must implement emit(event, payload) when events[] is configured.",
        );
      }
    }

    // If there is no mode, or we are server, we don't override anything
    // We are executing, the override happens on the client.
    if (mode === "none" || mode === "server") {
      // Do not patch in these modes, but preserve and return the runner value
      return value;
    }

    // Override selected tasks' run() to delegate to tunnel runner (reversible)
    for (const t of tasks) {
      if (!originalRuns.has(t)) {
        originalRuns.set(t, t.run as any);
      }
      t.run = (async (input: any) => {
        return value.run!(t as any, input);
      }) as any;
      (t as any)[symbolTunneledTask] = "client";
    }

    if (events.length > 0) {
      const selectedEventIds = new Set(events.map((e) => e.id));
      // Install a global emission interceptor for selected events
      // Install an emission interceptor for this tunnel instance as well
      eventManager.intercept(
        async (next: any, emission: IEventEmission<any>) => {
          if (!selectedEventIds.has(emission.id)) {
            return next(emission);
          }

          if (delivery === "local-only") {
            return next(emission);
          }

          if (delivery === "remote-only") {
            // Forward remotely only; skip local listeners
            return value.emit!(emission);
          }

          if (delivery === "remote-first") {
            try {
              await value.emit!(emission);
            } catch (_) {
              // Remote failed; fall back to local
              return next(emission);
            }
            // Remote succeeded; skip local
            return;
          }

          // mirror (default): local then remote; propagate remote failure
          await next(emission);
          return value.emit!(emission);
        },
      );
    }

    return value;
  },
  tags: [globalTags.system],
});

// Helper function to resolve tasks from the store
function resolveTasks(store: Store, selector: TunnelTaskSelector): ITask[] {
  const out: ITask[] = [];

  if (typeof selector === "function") {
    for (const t of store.tasks.values()) {
      if (selector(t.task)) {
        out.push(t.task);
      }
    }
    return out;
  }

  for (const item of selector) {
    if (typeof item === "string") {
      const st = store.tasks.get(item);
      if (!st)
        throw new Error(
          `Task ${item} not found while trying to resolve tasks for tunnel.`,
        );
      out.push(st.task);
    } else if (item && typeof item === "object") {
      // Assume it's a task definition
      const st = store.tasks.get(item.id);
      if (!st)
        throw new Error(
          `Task ${item} not found while trying to resolve tasks for tunnel.`,
        );

      out.push(st.task);
    }
  }

  return out;
}

// Helper function to resolve events from the store
function resolveEvents(store: Store, selector: TunnelEventSelector): IEvent[] {
  const out: IEvent[] = [];

  if (typeof selector === "function") {
    for (const e of store.events.values()) {
      if (selector(e.event)) {
        out.push(e.event);
      }
    }
    return out;
  }

  for (const item of selector) {
    let st;
    if (typeof item === "string") {
      st = store.events.get(item);
    } else if (item && typeof item === "object") {
      st = store.events.get(item.id);
    }

    if (!st)
      throw new Error(
        `Event ${item} not found while trying to resolve events for tunnel.`,
      );
    out.push(st.event);
  }

  return out;
}
