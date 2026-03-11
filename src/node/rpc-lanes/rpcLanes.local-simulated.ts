import { AsyncResource } from "node:async_hooks";
import type { IRpcLaneDefinition } from "../../defs";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import { withUserContexts } from "../exposure/handlers/contextWrapper";
import {
  buildAsyncContextHeader,
  resolveLaneAsyncContextPolicy,
} from "../remote-lanes/asyncContextAllowlist";
import {
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../remote-lanes/laneAuth";
import { getBindingAuthForRpcLane } from "./rpcLanes.auth";
import {
  assertTaskOwnership,
  type RpcLanesRuntimeContext,
} from "./rpcLanes.runtime.utils";
import type { RpcLanesResourceConfig } from "./types";
import { getRuntimeId } from "../../tools/runtimeMetadata";

export function applyLocalSimulatedModeRouting(
  context: RpcLanesRuntimeContext,
): void {
  const { config, resolved, dependencies, resourceId } = context;
  const store = dependencies.store;
  const runInLocalSimulatedScope = createLocalSimulatedScopeRunner(context);
  const roundTrip = <T>(value: T): T =>
    dependencies.serializer.parse<T>(dependencies.serializer.stringify(value));

  for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
    const taskEntry = store.tasks.get(taskId)!;
    const bindingAuth = getBindingAuthForRpcLane(config, lane.id);

    assertTaskOwnership(taskEntry.task.id, taskEntry.task, resourceId);

    const executeLocalTask = taskEntry.task.run;
    taskEntry.task = {
      ...taskEntry.task,
      run: (async (input: unknown, taskDependencies: unknown, taskContext) => {
        verifyProduceToken(lane.id, bindingAuth);
        const transportedInput = roundTrip(input);
        const localTask = executeLocalTask as (
          taskInput: unknown,
          dependencyBag: unknown,
          contextArg?: unknown,
        ) => Promise<unknown>;
        const result = await runInLocalSimulatedScope(lane, async () =>
          localTask(transportedInput, taskDependencies, taskContext),
        );
        return roundTrip(result);
      }) as typeof taskEntry.task.run,
      isRpcRouted: true,
      [symbolRpcLaneRoutedBy]: resourceId,
      [symbolRpcLanePolicy]: lane.policy,
    };
  }

  dependencies.eventManager.intercept(async (next, emission) => {
    const resolvedEmissionEventId =
      getRuntimeId(emission) ?? emission.path ?? emission.id;
    const lane = resolved.eventLaneByEventId.get(resolvedEmissionEventId);
    if (!lane) {
      return next(emission);
    }

    const bindingAuth = getBindingAuthForRpcLane(config, lane.id);
    verifyProduceToken(lane.id, bindingAuth);

    const transportedPayload = roundTrip(emission.data);
    const resultPayload = await runInLocalSimulatedScope(lane, async () => {
      emission.data = transportedPayload;
      await next(emission);
      return emission.data;
    });
    emission.data = roundTrip(resultPayload);
  });
}

function createLocalSimulatedScopeRunner(context: RpcLanesRuntimeContext) {
  const { config, dependencies } = context;
  const store = dependencies.store;
  const localSimulatedScope = new AsyncResource(
    "runner.rpcLanes.localSimulated",
  );

  const resolveLocalSimulatedAsyncContextPolicy = (
    lane: IRpcLaneDefinition,
  ) => {
    const configuredBinding = config.topology.bindings.find(
      (entry) => entry.lane.id === lane.id,
    );
    return resolveLaneAsyncContextPolicy({
      laneAsyncContexts: lane.asyncContexts,
      legacyAllowAsyncContext: configuredBinding?.allowAsyncContext,
    });
  };

  return async <T>(
    lane: IRpcLaneDefinition,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const policy = resolveLocalSimulatedAsyncContextPolicy(lane);
    const contextHeader = buildAsyncContextHeader({
      allowList: policy.allowList,
      registry: store.asyncContexts,
      serializer: dependencies.serializer,
    });
    const req = {
      headers: contextHeader ? { "x-runner-context": contextHeader } : {},
    } as any;

    return await new Promise<T>((resolve, reject) => {
      localSimulatedScope.runInAsyncScope(() => {
        Promise.resolve(
          withUserContexts(
            req,
            {
              store,
              serializer: dependencies.serializer,
            },
            fn,
            {
              allowAsyncContext: policy.allowAsyncContext,
              allowedAsyncContextIds: policy.allowList,
            },
          ),
        ).then(resolve, reject);
      });
    });
  };
}

function verifyProduceToken(
  laneId: string,
  bindingAuth: RpcLanesResourceConfig["topology"]["bindings"][number]["auth"],
): void {
  const token = issueRemoteLaneToken({
    laneId,
    bindingAuth,
    capability: "produce",
  });
  if (!token) {
    return;
  }
  verifyRemoteLaneToken({
    laneId,
    bindingAuth,
    token,
    requiredCapability: "produce",
  });
}
