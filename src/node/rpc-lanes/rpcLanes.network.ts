import { rpcLaneCommunicatorContractError } from "../../errors";
import type { IRpcLaneCommunicator, RpcLaneRequestOptions } from "../../defs";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import { buildEventRequestBody } from "../../remote-lanes/http/protocol";
import { createRetryingRpcLaneCommunicator } from "../../remote-lanes/retry";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "../../remote-lanes/http/constants";
import { defineInternalRequestMetadata } from "../../remote-lanes/http/requestMetadata";
import { buildAsyncContextHeader } from "../remote-lanes/asyncContextAllowlist";
import { hashRemoteLanePayload } from "../remote-lanes/laneAuth";
import { hasNodeFile, isReadable } from "../http/nodeFileDetection";
import { buildRpcLaneAuthHeaders } from "./rpcLanes.auth";
import type { RpcLaneResolvedBinding } from "./RpcLanesInternals";
import {
  assertTaskOwnership,
  type RpcLanesRuntimeContext,
} from "./rpcLanes.runtime.utils";

export function applyNetworkModeRouting(context: RpcLanesRuntimeContext): void {
  const { resolved, dependencies, resourceId } = context;
  const store = dependencies.store;
  const buildRequestOptions = createRpcLaneRequestOptionsBuilder(context);
  const retryingByLaneId = new Map<string, IRpcLaneCommunicator>();
  // Streams/files may be consumed on attempt one, so uploads use a no-retry wrapper.
  const singleAttemptByLaneId = new Map<string, IRpcLaneCommunicator>();
  for (const [laneId, laneBinding] of resolved.bindingsByLaneId) {
    singleAttemptByLaneId.set(
      laneId,
      createRetryingRpcLaneCommunicator(laneBinding.communicator, {
        ...laneBinding.retry,
        maxAttempts: 1,
      }),
    );
    retryingByLaneId.set(
      laneId,
      createRetryingRpcLaneCommunicator(
        laneBinding.communicator,
        laneBinding.retry,
      ),
    );
  }

  for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
    if (resolved.serveLaneIds.has(lane.id)) continue;
    const taskEntry = store.tasks.get(taskId)!;
    assertTaskOwnership(taskEntry.task.id, taskEntry.task, resourceId);
    const remoteTaskId = store.findIdByDefinition(taskEntry.task);
    const binding = resolved.bindingsByLaneId.get(lane.id)!;
    const singleAttempt = singleAttemptByLaneId.get(lane.id)!;
    const retrying = retryingByLaneId.get(lane.id)!;

    taskEntry.task = {
      ...taskEntry.task,
      run: (async (
        input: unknown,
        _deps: unknown,
        context?: { signal?: AbortSignal },
      ) => {
        const readableInput = isReadable(input);
        const nodeFileInput = readableInput ? undefined : hasNodeFile(input);
        const bodyReencoded = readableInput || nodeFileInput === true;
        const communicator = bodyReencoded ? singleAttempt : retrying;
        const runRemoteTask = communicator.task;
        if (typeof runRemoteTask !== "function") {
          rpcLaneCommunicatorContractError.throw({
            message: `rpcLane communicator for lane "${lane.id}" does not implement task(id, input).`,
          });
        }
        const executeRemoteTask = runRemoteTask as NonNullable<
          IRpcLaneCommunicator["task"]
        >;
        return executeRemoteTask.call(
          communicator,
          remoteTaskId,
          input,
          buildRequestOptions(binding, {
            kind: "task",
            id: remoteTaskId,
            payload: input,
            signal: context?.signal,
            bodyReencoded,
            hasNodeFile: nodeFileInput,
          }),
        );
      }) as typeof taskEntry.task.run,
      isRpcRouted: true,
      [symbolRpcLaneRoutedBy]: resourceId,
      [symbolRpcLanePolicy]: lane.policy,
    };
  }

  dependencies.eventManager.intercept(async (next, emission) => {
    const eventId = emission.id;
    const lane = resolved.eventLaneByEventId.get(eventId);
    if (!lane || resolved.serveLaneIds.has(lane.id)) {
      return next(emission);
    }

    const communicator = retryingByLaneId.get(lane.id)!;
    const binding = resolved.bindingsByLaneId.get(lane.id)!;
    if (typeof communicator.eventWithResult === "function") {
      const result = await communicator.eventWithResult(
        eventId,
        emission.data,
        buildRequestOptions(binding, {
          kind: "eventWithResult",
          id: eventId,
          payload: emission.data,
          signal: emission.signal,
        }),
      );
      if (result !== undefined) {
        emission.data = result;
      }
      return;
    }

    if (typeof communicator.event === "function") {
      await communicator.event(
        eventId,
        emission.data,
        buildRequestOptions(binding, {
          kind: "event",
          id: eventId,
          payload: emission.data,
          signal: emission.signal,
        }),
      );
      return;
    }

    rpcLaneCommunicatorContractError.throw({
      message: `rpcLane communicator for lane "${lane.id}" does not implement event(id, payload).`,
    });
  });
}

function createRpcLaneRequestOptionsBuilder(context: RpcLanesRuntimeContext) {
  const { store, serializer } = context.dependencies;

  return (
    binding: RpcLaneResolvedBinding,
    request: {
      kind: "task" | "event" | "eventWithResult";
      id: string;
      payload: unknown;
      signal?: AbortSignal;
      bodyReencoded?: boolean;
      hasNodeFile?: boolean;
    },
  ): RpcLaneRequestOptions => {
    const auth = binding.auth;
    const authenticated = auth !== undefined && auth.mode !== "none";
    let body: string | undefined;
    if (authenticated && !request.bodyReencoded) {
      body = serializer.stringify(
        request.kind === "task"
          ? { input: request.payload }
          : buildEventRequestBody(
              request.payload,
              request.kind === "eventWithResult"
                ? { returnPayload: true }
                : undefined,
            ),
      );
    }
    const contextHeader = buildAsyncContextHeader({
      allowList: binding.asyncContextAllowList,
      registry: store.asyncContexts,
      serializer,
    });

    // Use the same JSON text for signing and transport. For uploads, only
    // the context is signed, matching the receiver's empty-body convention.
    let headers = authenticated
      ? buildRpcLaneAuthHeaders({
          lane: binding.lane,
          bindingAuth: auth,
          target: {
            kind: request.kind === "task" ? "rpc-task" : "rpc-event",
            targetId: request.id,
            payloadHash: hashRemoteLanePayload(
              (body ?? "") + (contextHeader ?? ""),
            ),
          },
        })
      : undefined;
    if (contextHeader) {
      (headers ??= {})[RUNNER_ASYNC_CONTEXT_HEADER] = contextHeader;
    }

    const options = headers
      ? { headers, signal: request.signal }
      : { signal: request.signal };
    if (body !== undefined || request.hasNodeFile !== undefined) {
      defineInternalRequestMetadata(options, {
        kind: request.kind,
        id: request.id,
        payload: request.payload,
        serialized: body === undefined ? undefined : { body, serializer },
        hasNodeFile: request.hasNodeFile,
      });
    }
    return options;
  };
}
