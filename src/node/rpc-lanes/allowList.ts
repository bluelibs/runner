import type { Store } from "../../models/store/Store";
import type { ResourceStoreElementType } from "../../types/storeTypes";
import type { ITag } from "../../defs";
import { globalTags } from "../../globals/globalTags";
import type { RpcLanesResourceValue } from "./types";

export interface RpcLaneAllowList {
  enabled: boolean;
  taskIds: Set<string>;
  eventIds: Set<string>;
  taskAcceptsAsyncContext: Map<string, boolean>;
  eventAcceptsAsyncContext: Map<string, boolean>;
  taskAsyncContextAllowList: Map<string, readonly string[] | undefined>;
  eventAsyncContextAllowList: Map<string, readonly string[] | undefined>;
}

export function computeRpcLaneAllowList(store: Store): RpcLaneAllowList {
  const taskIds: Set<string> = new Set();
  const eventIds: Set<string> = new Set();
  const taskAcceptsAsyncContext = new Map<string, boolean>();
  const eventAcceptsAsyncContext = new Map<string, boolean>();
  const taskAsyncContextAllowList = new Map<
    string,
    readonly string[] | undefined
  >();
  const eventAsyncContextAllowList = new Map<
    string,
    readonly string[] | undefined
  >();

  const resourceEntries = Array.from(store.resources.values());
  const rpcLaneEntries = resourceEntries.filter((e: ResourceStoreElementType) =>
    e.resource.tags?.some((t: ITag) => t?.id === globalTags.rpcLanes.id),
  );

  const mergeAsyncContextDecision = (
    currentDecision: boolean | undefined,
    nextDecision: boolean,
  ): boolean => {
    if (currentDecision === false || nextDecision === false) return false;
    return true;
  };

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
    const taskContextAllowListMap = value.taskAsyncContextAllowList ?? {};
    const eventContextAllowListMap = value.eventAsyncContextAllowList ?? {};
    for (const taskId of serveTaskIds) {
      taskIds.add(taskId);
      const nextDecision = allowContextMap[taskId] !== false;
      const currentDecision = taskAcceptsAsyncContext.get(taskId);
      taskAcceptsAsyncContext.set(
        taskId,
        mergeAsyncContextDecision(currentDecision, nextDecision),
      );
      taskAsyncContextAllowList.set(taskId, taskContextAllowListMap[taskId]);
    }
    for (const eventId of serveEventIds) {
      eventIds.add(eventId);
      const nextDecision = eventAllowContextMap[eventId] !== false;
      const currentDecision = eventAcceptsAsyncContext.get(eventId);
      eventAcceptsAsyncContext.set(
        eventId,
        mergeAsyncContextDecision(currentDecision, nextDecision),
      );
      eventAsyncContextAllowList.set(
        eventId,
        eventContextAllowListMap[eventId],
      );
    }
  }

  const enabled = rpcLaneEntries.some((entry) => {
    const value = entry?.value as RpcLanesResourceValue | undefined;
    const hasTasks =
      Array.isArray(value?.serveTaskIds) && value.serveTaskIds.length > 0;
    const hasEvents =
      Array.isArray(value?.serveEventIds) && value.serveEventIds.length > 0;
    return hasTasks || hasEvents;
  });

  return {
    enabled,
    taskIds,
    eventIds,
    taskAcceptsAsyncContext,
    eventAcceptsAsyncContext,
    taskAsyncContextAllowList,
    eventAsyncContextAllowList,
  };
}
