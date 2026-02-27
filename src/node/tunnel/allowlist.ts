import type { Store } from "../../models/Store";
import type { ResourceStoreElementType } from "../../types/storeTypes";
import type { ITag } from "../../defs";
import { globalTags } from "../../globals/globalTags";

export interface TunnelAllowList {
  enabled: boolean;
  taskIds: Set<string>;
  eventIds: Set<string>;
  taskAcceptsAsyncContext: Map<string, boolean>;
  eventAcceptsAsyncContext: Map<string, boolean>;
}

/** Item that can be referenced - either a string id or an object with id */
type IdentifiableItem = string | { id: string };

/** Shape of a tunnel resource's initialized value */
interface TunnelResourceValue {
  mode?: "server" | "client" | "both";
  transport?: "http" | string;
  allowAsyncContext?: boolean;
  tasks?: IdentifiableItem[] | ((task: { id: string }) => boolean);
  events?: IdentifiableItem[] | ((event: { id: string }) => boolean);
}

interface RpcLanesResourceValue {
  serveTaskIds?: readonly string[];
  serveEventIds?: readonly string[];
  taskAllowAsyncContext?: Readonly<Record<string, boolean>>;
  eventAllowAsyncContext?: Readonly<Record<string, boolean>>;
}

export interface AllowListSelectorErrorInfo {
  selectorKind: "task" | "event";
  candidateId: string;
  tunnelResourceId: string;
  error: unknown;
}

export type AllowListSelectorErrorReporter = (
  info: AllowListSelectorErrorInfo,
) => void;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function defaultAllowListSelectorErrorReporter(
  info: AllowListSelectorErrorInfo,
) {
  console.warn("[runner] Tunnel allow-list selector failed; item skipped.", {
    selectorKind: info.selectorKind,
    candidateId: info.candidateId,
    tunnelResourceId: info.tunnelResourceId,
    error: toError(info.error),
  });
}

export function computeAllowList(
  store: Store,
  onSelectorError: AllowListSelectorErrorReporter = defaultAllowListSelectorErrorReporter,
): TunnelAllowList {
  const taskIds: Set<string> = new Set();
  const eventIds: Set<string> = new Set();
  const taskAcceptsAsyncContext = new Map<string, boolean>();
  const eventAcceptsAsyncContext = new Map<string, boolean>();

  const mergeAsyncContextPolicy = (
    target: Map<string, boolean>,
    id: string,
    accepts: boolean,
  ) => {
    const current = target.get(id);
    target.set(id, current === undefined ? accepts : current && accepts);
  };

  // Iterate actual store resource entries to access initialized values
  const resourceEntries = Array.from(store.resources?.values() ?? []);
  const tunnelEntries = resourceEntries.filter((e: ResourceStoreElementType) =>
    e.resource.tags?.some((t: ITag) => t?.id === globalTags.tunnel.id),
  );
  const rpcLaneEntries = resourceEntries.filter((e: ResourceStoreElementType) =>
    e.resource.tags?.some((t: ITag) => t?.id === globalTags.rpcLanes.id),
  );

  for (const entry of tunnelEntries) {
    const v = entry?.value as TunnelResourceValue | undefined;
    if (!v || typeof v !== "object") continue;
    if (v.mode !== "server" && v.mode !== "both") continue;
    if (v.transport && v.transport !== "http") continue;

    const tunnelResourceId = entry.resource.id;
    const acceptsAsyncContext = v.allowAsyncContext !== false;

    // Resolve tasks
    if (v.tasks) {
      if (typeof v.tasks === "function") {
        for (const st of store.tasks.values()) {
          try {
            if (v.tasks(st.task)) {
              taskIds.add(st.task.id);
              mergeAsyncContextPolicy(
                taskAcceptsAsyncContext,
                st.task.id,
                acceptsAsyncContext,
              );
            }
          } catch (error) {
            onSelectorError({
              selectorKind: "task",
              candidateId: st.task.id,
              tunnelResourceId,
              error,
            });
          }
        }
      } else if (Array.isArray(v.tasks)) {
        for (const t of v.tasks) {
          if (typeof t === "string") {
            taskIds.add(t);
            mergeAsyncContextPolicy(
              taskAcceptsAsyncContext,
              t,
              acceptsAsyncContext,
            );
          } else if (t && typeof t === "object" && t.id) {
            taskIds.add(t.id);
            mergeAsyncContextPolicy(
              taskAcceptsAsyncContext,
              t.id,
              acceptsAsyncContext,
            );
          }
        }
      }
    }

    // Resolve events
    if (v.events) {
      if (typeof v.events === "function") {
        for (const se of store.events.values()) {
          try {
            if (v.events(se.event)) {
              eventIds.add(se.event.id);
              mergeAsyncContextPolicy(
                eventAcceptsAsyncContext,
                se.event.id,
                acceptsAsyncContext,
              );
            }
          } catch (error) {
            onSelectorError({
              selectorKind: "event",
              candidateId: se.event.id,
              tunnelResourceId,
              error,
            });
          }
        }
      } else if (Array.isArray(v.events)) {
        for (const e of v.events) {
          if (typeof e === "string") {
            eventIds.add(e);
            mergeAsyncContextPolicy(
              eventAcceptsAsyncContext,
              e,
              acceptsAsyncContext,
            );
          } else if (e && typeof e === "object" && e.id) {
            eventIds.add(e.id);
            mergeAsyncContextPolicy(
              eventAcceptsAsyncContext,
              e.id,
              acceptsAsyncContext,
            );
          }
        }
      }
    }
  }

  for (const entry of rpcLaneEntries) {
    const value = entry?.value as RpcLanesResourceValue | undefined;
    if (!value || typeof value !== "object") continue;
    const serveTaskIds = Array.isArray(value.serveTaskIds)
      ? value.serveTaskIds
      : [];
    const serveEventIds = Array.isArray(value.serveEventIds)
      ? value.serveEventIds
      : [];
    const allowContextMap = value.taskAllowAsyncContext ?? {};
    const eventAllowContextMap = value.eventAllowAsyncContext ?? {};
    for (const taskId of serveTaskIds) {
      taskIds.add(taskId);
      const allowAsyncContext = allowContextMap[taskId] !== false;
      mergeAsyncContextPolicy(
        taskAcceptsAsyncContext,
        taskId,
        allowAsyncContext,
      );
    }
    for (const eventId of serveEventIds) {
      eventIds.add(eventId);
      const allowAsyncContext = eventAllowContextMap[eventId] !== false;
      mergeAsyncContextPolicy(
        eventAcceptsAsyncContext,
        eventId,
        allowAsyncContext,
      );
    }
  }

  const enabled = tunnelEntries.some(
    (r) =>
      (r?.value?.mode === "server" || r?.value?.mode === "both") &&
      (!r.value.transport || r.value.transport === "http"),
  );
  const rpcEnabled = rpcLaneEntries.some((entry) => {
    const value = entry?.value as RpcLanesResourceValue | undefined;
    const hasTasks =
      Array.isArray(value?.serveTaskIds) && value!.serveTaskIds.length > 0;
    const hasEvents =
      Array.isArray(value?.serveEventIds) && value!.serveEventIds.length > 0;
    return hasTasks || hasEvents;
  });

  return {
    enabled: enabled || rpcEnabled,
    taskIds,
    eventIds,
    taskAcceptsAsyncContext,
    eventAcceptsAsyncContext,
  };
}
