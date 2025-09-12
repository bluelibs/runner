import { defineResourceMiddleware } from "../../define";
import { globalTags } from "../globalTags";
import { globalResources } from "../globalResources";
import type { Store } from "../../models/Store";
import type { ITask, IEvent } from "../../defs";
import type {
  TunnelRunner,
  TunnelTagConfig,
  TunnelTaskSelector,
} from "../resources/tunnel/types";

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

    // Extract the tunnel configuration from the resource's tags
    const cfg = globalTags.tunnel.extract(resource.definition) as
      | TunnelTagConfig
      | undefined;

    if (!cfg) return value;

    const mode = cfg.mode || "none";
    const tasks = cfg.tasks ? resolveTasks(store, cfg.tasks) : [];
    const events = cfg.events ? resolveEvents(store, cfg.events as any) : [];

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

    // If there is no mode, or we are server, we don't override anything
    // We are executing, the override happens on the client.
    if (mode === "none" || mode === "server") {
      return;
    }

    // Override selected tasks' run() to delegate to tunnel runner
    for (const t of tasks) {
      t.run = (async (input: any) => {
        return value.run!(t as any, input);
      }) as any;
      // t[phantomTaskSymbol] = true;
    }

    if (events.length > 0) {
      const selectedEventIds = new Set(events.map((e) => e.id));
      // Install a global emission interceptor for selected events
      (eventManager as any).intercept(async (next: any, emission: any) => {
        if (selectedEventIds.has(emission.id)) {
          const st = store.events.get(emission.id);
          if (!st) {
            throw new Error(
              `Event ${emission.id} not found while trying to tunnel emission.`,
            );
          }
          await value.emit!(st.event as any, emission.data);
          return; // skip normal listeners
        }
        return next(emission);
      });
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
function resolveEvents(store: Store, selector: any): IEvent[] {
  const out: IEvent[] = [];

  if (typeof selector === "function") {
    for (const e of store.events.values()) {
      if (selector(e.event)) {
        out.push(e.event);
      }
    }
    return out;
  }

  for (const item of selector || []) {
    if (typeof item === "string") {
      const st = store.events.get(item);
      if (!st)
        throw new Error(
          `Event ${item} not found while trying to resolve events for tunnel.`,
        );
      out.push(st.event);
    } else if (item && typeof item === "object") {
      const st = store.events.get(item.id);
      if (!st)
        throw new Error(
          `Event ${item} not found while trying to resolve events for tunnel.`,
        );
      out.push(st.event);
    }
  }

  return out;
}
