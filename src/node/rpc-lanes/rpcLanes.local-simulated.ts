import { AsyncResource } from "node:async_hooks";
import type { IRpcLaneDefinition } from "../../defs";
import type { IAsyncContext } from "../../types/asyncContext";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import {
  hashRemoteLanePayload,
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../remote-lanes/laneAuth";
import {
  resolveRegistryAsyncContextIds,
  resolveLaneAsyncContextPolicy,
} from "../remote-lanes/asyncContextAllowlist";
import {
  assertTaskOwnership,
  type RpcLanesRuntimeContext,
} from "./rpcLanes.runtime.utils";
import { getBindingAuthForRpcLane } from "./rpcLanes.auth";

export function applyLocalSimulatedModeRouting(
  context: RpcLanesRuntimeContext,
): void {
  const { resolved, dependencies, resourceId } = context;
  const store = dependencies.store;
  const runInLocalSimulatedScope = createLocalSimulatedScopeRunner(context);
  const roundTrip = <T>(value: T): T =>
    dependencies.serializer.parse<T>(dependencies.serializer.stringify(value));

  for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
    const taskEntry = store.tasks.get(taskId)!;

    assertTaskOwnership(taskEntry.task.id, taskEntry.task, resourceId);

    const executeLocalTask = taskEntry.task.run;
    taskEntry.task = {
      ...taskEntry.task,
      run: (async (input: unknown, taskDependencies: unknown, taskContext) => {
        const transportedInput = roundTrip(input);
        const localTask = executeLocalTask as (
          taskInput: unknown,
          dependencyBag: unknown,
          contextArg?: unknown,
        ) => Promise<unknown>;
        const result = await runInLocalSimulatedScope(
          lane,
          {
            kind: "rpc-task",
            targetId: taskId,
            payloadHash: hashRemoteLanePayload(
              dependencies.serializer.stringify({ input: transportedInput }),
            ),
          },
          async () =>
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
    const resolvedEmissionEventId = emission.id;
    const lane = resolved.eventLaneByEventId.get(resolvedEmissionEventId);
    if (!lane) {
      return next(emission);
    }

    const transportedPayload = roundTrip(emission.data);
    const resultPayload = await runInLocalSimulatedScope(
      lane,
      {
        kind: "rpc-event",
        targetId: resolvedEmissionEventId,
        payloadHash: hashRemoteLanePayload(
          dependencies.serializer.stringify({ payload: transportedPayload }),
        ),
      },
      async () => {
        emission.data = transportedPayload;
        await next(emission);
        return emission.data;
      },
    );
    emission.data = roundTrip(resultPayload);
  });
}

function createLocalSimulatedScopeRunner(context: RpcLanesRuntimeContext) {
  const { config, dependencies } = context;
  const store = dependencies.store;
  const localSimulatedScopeFactory = new AsyncResource(
    "runner.rpcLanes.localSimulated.factory",
  );
  const asyncContextPolicyByLaneId = new Map(
    config.topology.bindings.map((binding) => [
      binding.lane.id,
      resolveLaneAsyncContextPolicy({
        laneAsyncContexts: binding.lane.asyncContexts,
        legacyAllowAsyncContext: binding.allowAsyncContext,
      }),
    ]),
  );

  const resolveLocalSimulatedAsyncContextPolicy = (lane: IRpcLaneDefinition) =>
    asyncContextPolicyByLaneId.get(lane.id) ??
    resolveLaneAsyncContextPolicy({
      laneAsyncContexts: lane.asyncContexts,
      legacyAllowAsyncContext: undefined,
    });

  return async <T>(
    lane: IRpcLaneDefinition,
    target: {
      kind: "rpc-task" | "rpc-event";
      targetId: string;
      payloadHash?: string;
    },
    fn: () => Promise<T>,
  ): Promise<T> => {
    const policy = resolveLocalSimulatedAsyncContextPolicy(lane);
    const capturedContexts = captureSerializedAsyncContexts({
      allowList: policy.allowList,
      registry: store.asyncContexts,
    });
    const bindingAuth = getBindingAuthForRpcLane(config, lane.id);
    const token = issueRemoteLaneToken({
      laneId: lane.id,
      bindingAuth,
      capability: "produce",
      target,
    });

    return await new Promise<T>((resolve, reject) => {
      localSimulatedScopeFactory.runInAsyncScope(() => {
        const localSimulatedScope = new AsyncResource(
          "runner.rpcLanes.localSimulated",
        );
        localSimulatedScope.runInAsyncScope(() => {
          Promise.resolve()
            .then(async () => {
              if (token) {
                verifyRemoteLaneToken({
                  laneId: lane.id,
                  bindingAuth,
                  token,
                  requiredCapability: "produce",
                  expectedTarget: target,
                  replayProtector: context.resolved.replayProtector,
                });
              }
              return await applySerializedAsyncContexts(
                capturedContexts,
                fn,
                policy.allowAsyncContext,
              );
            })
            .then(resolve, reject);
        });
      });
    });
  };
}

function captureSerializedAsyncContexts(options: {
  allowList: readonly string[] | undefined;
  registry: ReadonlyMap<string, IAsyncContext<unknown>>;
}): Array<{ context: IAsyncContext<unknown>; raw: string }> {
  const resolvedIds = resolveRegistryAsyncContextIds(
    options.registry,
    options.allowList,
  );
  const captured: Array<{ context: IAsyncContext<unknown>; raw: string }> = [];

  const idsToCapture =
    resolvedIds === undefined
      ? Array.from(options.registry.keys())
      : Array.from(resolvedIds);

  for (const id of idsToCapture) {
    const context = options.registry.get(id);
    if (!context) {
      continue;
    }

    try {
      captured.push({ context, raw: context.serialize(context.use()) });
    } catch {
      // Missing context in the current scope is expected for non-provided entries.
    }
  }

  return captured;
}

async function applySerializedAsyncContexts<T>(
  capturedContexts: Array<{ context: IAsyncContext<unknown>; raw: string }>,
  fn: () => Promise<T>,
  allowAsyncContext: boolean,
): Promise<T> {
  if (!allowAsyncContext || capturedContexts.length === 0) {
    return fn();
  }

  let wrapped = fn;

  for (const { context, raw } of capturedContexts) {
    try {
      const value = context.parse(raw);
      const previous = wrapped;
      wrapped = async () => await context.provide(value, previous);
    } catch {
      // Ignore per-context rehydration failures and continue with the rest.
    }
  }

  return wrapped();
}
