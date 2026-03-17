import { globalTags } from "../../../globals/globalTags";
import type { Store } from "../../../models/Store";
import { computeRpcLaneAllowList } from "../../rpc-lanes";

function createStore(
  resources: Array<{ tags?: unknown[]; value?: unknown }>,
): Store {
  return {
    resources: new Map(
      resources.map((resource, index) => [
        `tests-rpc-lanes-allow-list-resource-${index}`,
        {
          resource: {
            id: `tests-rpc-lanes-allow-list-resource-${index}`,
            tags: resource.tags ?? [],
          },
          value: resource.value,
        },
      ]),
    ),
  } as unknown as Store;
}

describe("computeRpcLaneAllowList", () => {
  it("ignores rpc-lanes resources with non-object runtime values", () => {
    const store = createStore([
      {
        tags: [globalTags.rpcLanes],
        value: 42,
      },
    ]);

    const allowList = computeRpcLaneAllowList(store);
    expect(allowList.enabled).toBe(false);
    expect(allowList.taskIds.size).toBe(0);
    expect(allowList.eventIds.size).toBe(0);
  });

  it("builds task/event and async-context policy maps from served ids", () => {
    const taskId = "tests-rpc-lanes-allow-list-task";
    const eventId = "tests-rpc-lanes-allow-list-event";
    const store = createStore([
      {
        tags: [globalTags.rpcLanes],
        value: {
          serveTaskIds: [taskId],
          serveEventIds: [eventId],
          taskAllowAsyncContext: { [taskId]: false },
          eventAllowAsyncContext: { [eventId]: true },
          taskAsyncContextAllowList: { [taskId]: ["ctx-a"] },
          eventAsyncContextAllowList: { [eventId]: ["ctx-b"] },
        },
      },
    ]);

    const allowList = computeRpcLaneAllowList(store);
    expect(allowList.enabled).toBe(true);
    expect(allowList.taskIds.has(taskId)).toBe(true);
    expect(allowList.eventIds.has(eventId)).toBe(true);
    expect(allowList.taskAcceptsAsyncContext.get(taskId)).toBe(false);
    expect(allowList.eventAcceptsAsyncContext.get(eventId)).toBe(true);
    expect(allowList.taskAsyncContextAllowList.get(taskId)).toEqual(["ctx-a"]);
    expect(allowList.eventAsyncContextAllowList.get(eventId)).toEqual([
      "ctx-b",
    ]);
  });

  it("falls back to empty served id lists when resource value shapes are invalid", () => {
    const store = createStore([
      {
        tags: [globalTags.rpcLanes],
        value: {
          serveTaskIds: "not-an-array",
          serveEventIds: null,
        },
      },
    ]);

    const allowList = computeRpcLaneAllowList(store);
    expect(allowList.enabled).toBe(false);
    expect(allowList.taskIds.size).toBe(0);
    expect(allowList.eventIds.size).toBe(0);
  });

  it("conservatively merges async context decisions across overlapping resources", () => {
    const taskId = "tests-rpc-lanes-overlap-task";
    const eventId = "tests-rpc-lanes-overlap-event";
    const store = createStore([
      {
        tags: [globalTags.rpcLanes],
        value: {
          serveTaskIds: [taskId],
          serveEventIds: [eventId],
          taskAllowAsyncContext: { [taskId]: false },
          eventAllowAsyncContext: { [eventId]: false },
          taskAsyncContextAllowList: { [taskId]: ["ctx-a"] },
          eventAsyncContextAllowList: { [eventId]: ["ctx-a"] },
        },
      },
      {
        tags: [globalTags.rpcLanes],
        value: {
          serveTaskIds: [taskId],
          serveEventIds: [eventId],
          taskAllowAsyncContext: { [taskId]: true },
          eventAllowAsyncContext: { [eventId]: true },
          taskAsyncContextAllowList: { [taskId]: ["ctx-b"] },
          eventAsyncContextAllowList: { [eventId]: ["ctx-b"] },
        },
      },
    ]);

    const allowList = computeRpcLaneAllowList(store);
    expect(allowList.taskAcceptsAsyncContext.get(taskId)).toBe(false);
    expect(allowList.eventAcceptsAsyncContext.get(eventId)).toBe(false);
    expect(allowList.taskAsyncContextAllowList.get(taskId)).toEqual(["ctx-b"]);
    expect(allowList.eventAsyncContextAllowList.get(eventId)).toEqual([
      "ctx-b",
    ]);
  });
});
