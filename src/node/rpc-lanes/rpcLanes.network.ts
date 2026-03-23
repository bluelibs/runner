import { rpcLaneCommunicatorContractError } from "../../errors";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import { buildAsyncContextHeader } from "../remote-lanes/asyncContextAllowlist";
import { hashRemoteLanePayload } from "../remote-lanes/laneAuth";
import { buildRpcLaneAuthHeaders } from "./rpcLanes.auth";
import {
  assertTaskOwnership,
  type RpcLanesRuntimeContext,
} from "./rpcLanes.runtime.utils";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "../../remote-lanes/http/constants";

export function applyNetworkModeRouting(context: RpcLanesRuntimeContext): void {
  const { resolved, dependencies, resourceId } = context;
  const store = dependencies.store;
  const buildRpcLaneRequestHeaders =
    createRpcLaneRequestHeadersBuilder(context);

  for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
    const taskEntry = store.tasks.get(taskId)!;
    const binding = resolved.bindingsByLaneId.get(lane.id)!;
    const isServed = resolved.serveLaneIds.has(lane.id);

    if (isServed) {
      continue;
    }

    assertTaskOwnership(taskEntry.task.id, taskEntry.task, resourceId);

    taskEntry.task = {
      ...taskEntry.task,
      run: (async (
        input: unknown,
        _deps: unknown,
        context?: { signal?: AbortSignal },
      ) => {
        const runRemoteTask = binding.communicator.task;
        if (typeof runRemoteTask !== "function") {
          rpcLaneCommunicatorContractError.throw({
            message: `rpcLane communicator for lane "${lane.id}" does not implement task(id, input).`,
          });
        }
        const executeRemoteTask = runRemoteTask as (
          id: string,
          input?: unknown,
          options?: {
            headers?: Record<string, string>;
            signal?: AbortSignal;
          },
        ) => Promise<unknown>;
        const remoteTaskId = store.findIdByDefinition(taskEntry.task);
        const headers = buildRpcLaneRequestHeaders(lane.id, {
          kind: "rpc-task",
          targetId: remoteTaskId,
          payloadHash: hashRemoteLanePayload(
            dependencies.serializer.stringify({ input }),
          ),
        });
        return headers
          ? executeRemoteTask(remoteTaskId, input, {
              headers,
              signal: context?.signal,
            })
          : executeRemoteTask(remoteTaskId, input, {
              signal: context?.signal,
            });
      }) as typeof taskEntry.task.run,
      isRpcRouted: true,
      [symbolRpcLaneRoutedBy]: resourceId,
      [symbolRpcLanePolicy]: lane.policy,
    };
  }

  dependencies.eventManager.intercept(async (next, emission) => {
    const eventId = emission.id;
    const lane = resolved.eventLaneByEventId.get(eventId);
    if (!lane) {
      return next(emission);
    }

    const binding = resolved.bindingsByLaneId.get(lane.id)!;
    const isServed = resolved.serveLaneIds.has(lane.id);
    if (isServed) {
      return next(emission);
    }

    if (typeof binding.communicator.eventWithResult === "function") {
      const headers = buildRpcLaneRequestHeaders(lane.id, {
        kind: "rpc-event",
        targetId: eventId,
        payloadHash: hashRemoteLanePayload(
          dependencies.serializer.stringify({ payload: emission.data }),
        ),
      });
      const result = await binding.communicator.eventWithResult(
        eventId,
        emission.data,
        headers
          ? { headers, signal: emission.signal }
          : { signal: emission.signal },
      );
      if (result !== undefined) {
        emission.data = result;
      }
      return;
    }

    if (typeof binding.communicator.event === "function") {
      const headers = buildRpcLaneRequestHeaders(lane.id, {
        kind: "rpc-event",
        targetId: eventId,
        payloadHash: hashRemoteLanePayload(
          dependencies.serializer.stringify({ payload: emission.data }),
        ),
      });
      if (headers) {
        await binding.communicator.event(eventId, emission.data, {
          headers,
          signal: emission.signal,
        });
      } else {
        await binding.communicator.event(eventId, emission.data, {
          signal: emission.signal,
        });
      }
      return;
    }

    rpcLaneCommunicatorContractError.throw({
      message: `rpcLane communicator for lane "${lane.id}" does not implement event(id, payload).`,
    });
  });
}

function createRpcLaneRequestHeadersBuilder(context: RpcLanesRuntimeContext) {
  const { resolved, dependencies } = context;
  const store = dependencies.store;

  return (
    laneId: string,
    target: {
      kind: "rpc-task" | "rpc-event";
      targetId: string;
      payloadHash?: string;
    },
  ): Record<string, string> | undefined => {
    const binding = resolved.bindingsByLaneId.get(laneId)!;
    const headers = {
      ...(buildRpcLaneAuthHeaders({
        lane: binding.lane,
        bindingAuth: binding.auth,
        target,
      }) ?? {}),
    };
    const contextHeader = buildAsyncContextHeader({
      allowList: binding.asyncContextAllowList,
      registry: store.asyncContexts,
      serializer: dependencies.serializer,
    });
    if (contextHeader) {
      headers[RUNNER_ASYNC_CONTEXT_HEADER] = contextHeader;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  };
}
