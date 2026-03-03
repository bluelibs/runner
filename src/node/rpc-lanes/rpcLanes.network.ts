import { rpcLaneCommunicatorContractError } from "../../errors";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import { buildAsyncContextHeader } from "../remote-lanes/asyncContextAllowlist";
import { buildRpcLaneAuthHeaders } from "./rpcLanes.auth";
import {
  assertTaskOwnership,
  type RpcLanesRuntimeContext,
} from "./rpcLanes.runtime.utils";

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
      run: (async (input: unknown) => {
        const runRemoteTask = binding.communicator.task;
        if (typeof runRemoteTask !== "function") {
          rpcLaneCommunicatorContractError.throw({
            message: `rpcLane communicator for lane "${lane.id}" does not implement task(id, input).`,
          });
        }
        const executeRemoteTask = runRemoteTask as (
          id: string,
          input?: unknown,
          options?: { headers?: Record<string, string> },
        ) => Promise<unknown>;
        const headers = buildRpcLaneRequestHeaders(lane.id);
        return headers
          ? executeRemoteTask(taskEntry.task.id, input, { headers })
          : executeRemoteTask(taskEntry.task.id, input);
      }) as typeof taskEntry.task.run,
      isRpcRouted: true,
      [symbolRpcLaneRoutedBy]: resourceId,
      [symbolRpcLanePolicy]: lane.policy,
    };
  }

  dependencies.eventManager.intercept(async (next, emission) => {
    const lane = resolved.eventLaneByEventId.get(emission.id);
    if (!lane) {
      return next(emission);
    }

    const binding = resolved.bindingsByLaneId.get(lane.id)!;
    const isServed = resolved.serveLaneIds.has(lane.id);
    if (isServed) {
      return next(emission);
    }

    if (typeof binding.communicator.eventWithResult === "function") {
      const headers = buildRpcLaneRequestHeaders(lane.id);
      const result = await binding.communicator.eventWithResult(
        emission.id,
        emission.data,
        headers ? { headers } : undefined,
      );
      if (result !== undefined) {
        emission.data = result;
      }
      return;
    }

    if (typeof binding.communicator.event === "function") {
      const headers = buildRpcLaneRequestHeaders(lane.id);
      if (headers) {
        await binding.communicator.event(emission.id, emission.data, {
          headers,
        });
      } else {
        await binding.communicator.event(emission.id, emission.data);
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

  return (laneId: string): Record<string, string> | undefined => {
    const binding = resolved.bindingsByLaneId.get(laneId)!;
    const headers = {
      ...(buildRpcLaneAuthHeaders(binding.lane, binding.auth) ?? {}),
    };
    const contextHeader = buildAsyncContextHeader({
      allowList: binding.asyncContextAllowList,
      registry: store.asyncContexts,
      serializer: dependencies.serializer,
    });
    if (contextHeader) {
      headers["x-runner-context"] = contextHeader;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  };
}
