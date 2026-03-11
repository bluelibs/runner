export interface NodeExposurePolicySnapshot {
  enabled: boolean;
  taskIds: readonly string[];
  eventIds: readonly string[];
  taskAllowAsyncContext: Readonly<Record<string, boolean>>;
  eventAllowAsyncContext: Readonly<Record<string, boolean>>;
  taskAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
  eventAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
}

export const EMPTY_NODE_EXPOSURE_POLICY: NodeExposurePolicySnapshot =
  Object.freeze({
    enabled: false,
    taskIds: Object.freeze([] as string[]),
    eventIds: Object.freeze([] as string[]),
    taskAllowAsyncContext: Object.freeze({}),
    eventAllowAsyncContext: Object.freeze({}),
    taskAsyncContextAllowList: Object.freeze({}),
    eventAsyncContextAllowList: Object.freeze({}),
  });

export function hasServedEndpoints(
  policy: NodeExposurePolicySnapshot,
): boolean {
  return policy.taskIds.length > 0 || policy.eventIds.length > 0;
}
