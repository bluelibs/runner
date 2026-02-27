import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import { createNodeExposure } from "../exposure/createNodeExposure";
import type { NodeExposureDeps } from "../exposure/resourceTypes";
import { symbolTunneledBy } from "../../types/symbols";
import {
  rpcLaneCommunicatorContractError,
  rpcLanesExposureModeError,
  tunnelOwnershipConflictError,
} from "../../errors";
import {
  resolveRpcLaneState,
  toRpcLanesResourceValue,
} from "./RpcLanesInternals";
import type { RpcLanesResourceConfig, RpcLanesResourceValue } from "./types";
import { collectRpcLaneCommunicatorResourceDependencies } from "./RpcLanesInternals";

type RpcLanesDependencies = NodeExposureDeps & Record<string, unknown>;

export const rpcLanesResource = defineResource<
  RpcLanesResourceConfig,
  Promise<RpcLanesResourceValue>
>({
  id: "platform.node.resources.rpcLanes",
  tags: [globalTags.rpcLanes],
  dependencies: (config) => ({
    store: globalResources.store,
    authValidators: globalTags.authValidator,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
    serializer: globalResources.serializer,
    ...collectRpcLaneCommunicatorResourceDependencies(config),
  }),
  async init(config, dependencies) {
    const typedDependencies = dependencies as RpcLanesDependencies;
    const store = typedDependencies.store;
    const resolved = resolveRpcLaneState(config, typedDependencies, store);
    const resourceId = "platform.node.resources.rpcLanes";

    if (resolved.mode === "network") {
      for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
        const taskEntry = store.tasks.get(taskId)!;

        const binding = resolved.bindingsByLaneId.get(lane.id)!;
        const isServed = resolved.serveLaneIds.has(lane.id);

        if (isServed) {
          continue;
        }

        const currentOwner = taskEntry.task[symbolTunneledBy];
        if (currentOwner && currentOwner !== resourceId) {
          tunnelOwnershipConflictError.throw({
            taskId: taskEntry.task.id,
            currentOwnerId: currentOwner,
            attemptedOwnerId: resourceId,
          });
        }

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
            ) => Promise<unknown>;
            return executeRemoteTask(taskEntry.task.id, input);
          }) as typeof taskEntry.task.run,
          isTunneled: true,
          [symbolTunneledBy]: resourceId,
        };
      }

      typedDependencies.eventManager.intercept(async (next, emission) => {
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
          const result = await binding.communicator.eventWithResult(
            emission.id,
            emission.data,
          );
          if (result !== undefined) {
            emission.data = result;
          }
          return;
        }

        if (typeof binding.communicator.event === "function") {
          await binding.communicator.event(emission.id, emission.data);
          return;
        }

        rpcLaneCommunicatorContractError.throw({
          message: `rpcLane communicator for lane "${lane.id}" does not implement event(id, payload).`,
        });
      });
    }

    if (resolved.mode === "local-simulated") {
      const roundTrip = <T>(value: T): T =>
        typedDependencies.serializer.parse<T>(
          typedDependencies.serializer.stringify(value),
        );

      for (const [taskId] of resolved.taskLaneByTaskId.entries()) {
        const taskEntry = store.tasks.get(taskId)!;

        const currentOwner = taskEntry.task[symbolTunneledBy];
        if (currentOwner && currentOwner !== resourceId) {
          tunnelOwnershipConflictError.throw({
            taskId: taskEntry.task.id,
            currentOwnerId: currentOwner,
            attemptedOwnerId: resourceId,
          });
        }

        const executeLocalTask = taskEntry.task.run;
        taskEntry.task = {
          ...taskEntry.task,
          run: (async (input: unknown, taskDependencies: unknown, context) => {
            const transportedInput = roundTrip(input);
            const localTask = executeLocalTask as (
              input: unknown,
              dependencies: unknown,
              context?: unknown,
            ) => Promise<unknown>;
            const result = await localTask(
              transportedInput,
              taskDependencies,
              context,
            );
            return roundTrip(result);
          }) as typeof taskEntry.task.run,
          isTunneled: true,
          [symbolTunneledBy]: resourceId,
        };
      }

      typedDependencies.eventManager.intercept(async (next, emission) => {
        if (!resolved.eventLaneByEventId.has(emission.id)) {
          return next(emission);
        }

        emission.data = roundTrip(emission.data);
        await next(emission);
        emission.data = roundTrip(emission.data);
      });
    }

    let exposure: { close: () => Promise<void> } | null = null;
    if (config.exposure?.http) {
      if (resolved.mode !== "network") {
        rpcLanesExposureModeError.throw({ mode: resolved.mode });
      }
      exposure = await createNodeExposure(
        { http: config.exposure.http },
        typedDependencies as NodeExposureDeps,
      );
    }

    return toRpcLanesResourceValue(resolved, exposure);
  },
  async dispose(value) {
    if (value?.exposure) {
      await value.exposure.close();
    }
  },
});
