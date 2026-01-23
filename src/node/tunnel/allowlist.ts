import type { Store } from "../../models/Store";
import type { ResourceStoreElementType } from "../../types/storeTypes";
import type { ITag } from "../../defs";
import { globalTags } from "../../globals/globalTags";

export interface TunnelAllowList {
  enabled: boolean;
  taskIds: Set<string>;
  eventIds: Set<string>;
}

/** Item that can be referenced - either a string id or an object with id */
type IdentifiableItem = string | { id: string };

/** Shape of a tunnel resource's initialized value */
interface TunnelResourceValue {
  mode?: "server" | "client" | "both";
  transport?: "http" | string;
  tasks?: IdentifiableItem[] | ((task: { id: string }) => boolean);
  events?: IdentifiableItem[] | ((event: { id: string }) => boolean);
}

export function computeAllowList(store: Store): TunnelAllowList {
  const taskIds: Set<string> = new Set();
  const eventIds: Set<string> = new Set();

  // Iterate actual store resource entries to access initialized values
  const resourceEntries = Array.from(store.resources?.values() ?? []);
  const tunnelEntries = resourceEntries.filter((e: ResourceStoreElementType) =>
    e.resource.tags?.some((t: ITag) => t?.id === globalTags.tunnel.id),
  );

  for (const entry of tunnelEntries) {
    const v = entry?.value as TunnelResourceValue | undefined;
    if (!v || typeof v !== "object") continue;
    if (v.mode !== "server" && v.mode !== "both") continue;
    if (v.transport && v.transport !== "http") continue;

    // Resolve tasks
    if (v.tasks) {
      if (typeof v.tasks === "function") {
        for (const st of store.tasks.values()) {
          try {
            if (v.tasks(st.task)) taskIds.add(st.task.id);
          } catch (_) {}
        }
      } else if (Array.isArray(v.tasks)) {
        for (const t of v.tasks) {
          if (typeof t === "string") {
            taskIds.add(t);
          } else if (t && typeof t === "object" && t.id) {
            taskIds.add(t.id);
          }
        }
      }
    }

    // Resolve events
    if (v.events) {
      if (typeof v.events === "function") {
        for (const se of store.events.values()) {
          try {
            if (v.events(se.event)) eventIds.add(se.event.id);
          } catch (_) {}
        }
      } else if (Array.isArray(v.events)) {
        for (const e of v.events) {
          if (typeof e === "string") {
            eventIds.add(e);
          } else if (e && typeof e === "object" && e.id) {
            eventIds.add(e.id);
          }
        }
      }
    }
  }

  const enabled = tunnelEntries.some(
    (r) =>
      (r?.value?.mode === "server" || r?.value?.mode === "both") &&
      (!r.value.transport || r.value.transport === "http"),
  );

  return { enabled, taskIds, eventIds };
}
