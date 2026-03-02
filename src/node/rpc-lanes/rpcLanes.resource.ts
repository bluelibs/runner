import { AsyncResource } from "node:async_hooks";
import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import type { IRpcLaneDefinition } from "../../defs";
import { createNodeExposure } from "../exposure/createNodeExposure";
import type { NodeExposureDeps } from "../exposure/resourceTypes";
import { withUserContexts } from "../exposure/handlers/contextWrapper";
import {
  symbolRpcLanePolicy,
  symbolRpcLaneRoutedBy,
} from "../../types/symbols";
import {
  rpcLaneOwnershipConflictError,
  rpcLaneCommunicatorContractError,
  rpcLanesExposureModeError,
} from "../../errors";
import {
  issueRemoteLaneToken,
  verifyRemoteLaneToken,
} from "../remote-lanes/laneAuth";
import {
  resolveRpcLaneState,
  toRpcLanesResourceValue,
} from "./RpcLanesInternals";
import type { RpcLanesResourceConfig, RpcLanesResourceValue } from "./types";
import { collectRpcLaneCommunicatorResourceDependencies } from "./RpcLanesInternals";
import { rpcLanesResourceConfigSchema } from "./configSchema";
import {
  authorizeRpcLaneRequest,
  buildRpcLaneAuthHeaders,
  enforceRpcLaneAuthReadiness,
  getBindingAuthForRpcLane,
} from "./rpcLanes.auth";
import {
  buildAsyncContextHeader,
  resolveLaneAsyncContextAllowList,
} from "../remote-lanes/asyncContextAllowlist";

type RpcLanesDependencies = NodeExposureDeps & Record<string, unknown>;

export const rpcLanesResource = defineResource<
  RpcLanesResourceConfig,
  Promise<RpcLanesResourceValue>
>({
  id: "platform.node.resources.rpcLanes",
  tags: [globalTags.rpcLanes],
  configSchema: rpcLanesResourceConfigSchema,
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
    enforceRpcLaneAuthReadiness(config, resolved);

    const buildRpcLaneRequestHeaders = (laneId: string) => {
      const binding = resolved.bindingsByLaneId.get(laneId)!;

      const headers = {
        ...(buildRpcLaneAuthHeaders(binding.lane, binding.auth) ?? {}),
      };
      const contextHeader = buildAsyncContextHeader({
        allowList: binding.asyncContextAllowList,
        registry: store.asyncContexts,
        serializer: typedDependencies.serializer,
      });
      if (contextHeader) {
        headers["x-runner-context"] = contextHeader;
      }
      return Object.keys(headers).length > 0 ? headers : undefined;
    };

    const localSimulatedScope = new AsyncResource(
      "runner.rpcLanes.localSimulated",
    );
    const resolveLocalSimulatedAsyncContextPolicy = (
      lane: IRpcLaneDefinition,
    ) => {
      const configuredBinding = config.topology.bindings.find(
        (entry) => entry.lane.id === lane.id,
      );
      const allowList = resolveLaneAsyncContextAllowList({
        laneAsyncContexts: lane.asyncContexts,
        legacyAllowAsyncContext: configuredBinding?.allowAsyncContext,
      });
      const allowAsyncContext =
        allowList === undefined ? true : allowList.length > 0;

      return {
        allowList,
        allowAsyncContext,
      };
    };
    const runInLocalSimulatedScope = async <T>(
      lane: IRpcLaneDefinition,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const policy = resolveLocalSimulatedAsyncContextPolicy(lane);
      const contextHeader = buildAsyncContextHeader({
        allowList: policy.allowList,
        registry: store.asyncContexts,
        serializer: typedDependencies.serializer,
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
                serializer: typedDependencies.serializer,
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

    if (resolved.mode === "network") {
      for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
        const taskEntry = store.tasks.get(taskId)!;

        const binding = resolved.bindingsByLaneId.get(lane.id)!;
        const isServed = resolved.serveLaneIds.has(lane.id);

        if (isServed) {
          continue;
        }

        const currentOwner = taskEntry.task[symbolRpcLaneRoutedBy];
        if (currentOwner && currentOwner !== resourceId) {
          rpcLaneOwnershipConflictError.throw({
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

    if (resolved.mode === "local-simulated") {
      const roundTrip = <T>(value: T): T =>
        typedDependencies.serializer.parse<T>(
          typedDependencies.serializer.stringify(value),
        );

      for (const [taskId, lane] of resolved.taskLaneByTaskId.entries()) {
        const taskEntry = store.tasks.get(taskId)!;
        const bindingAuth = getBindingAuthForRpcLane(config, lane.id);

        const currentOwner = taskEntry.task[symbolRpcLaneRoutedBy];
        if (currentOwner && currentOwner !== resourceId) {
          rpcLaneOwnershipConflictError.throw({
            taskId: taskEntry.task.id,
            currentOwnerId: currentOwner,
            attemptedOwnerId: resourceId,
          });
        }

        const executeLocalTask = taskEntry.task.run;
        taskEntry.task = {
          ...taskEntry.task,
          run: (async (input: unknown, taskDependencies: unknown, context) => {
            const token = issueRemoteLaneToken({
              laneId: lane.id,
              bindingAuth,
              capability: "produce",
            });
            if (token) {
              verifyRemoteLaneToken({
                laneId: lane.id,
                bindingAuth,
                token,
                requiredCapability: "produce",
              });
            }
            const transportedInput = roundTrip(input);
            const localTask = executeLocalTask as (
              input: unknown,
              dependencies: unknown,
              context?: unknown,
            ) => Promise<unknown>;
            const result = await runInLocalSimulatedScope(lane, async () =>
              localTask(transportedInput, taskDependencies, context),
            );
            return roundTrip(result);
          }) as typeof taskEntry.task.run,
          isRpcRouted: true,
          [symbolRpcLaneRoutedBy]: resourceId,
          [symbolRpcLanePolicy]: lane.policy,
        };
      }

      typedDependencies.eventManager.intercept(async (next, emission) => {
        const lane = resolved.eventLaneByEventId.get(emission.id);
        if (!lane) {
          return next(emission);
        }
        const bindingAuth = getBindingAuthForRpcLane(config, lane.id);
        const token = issueRemoteLaneToken({
          laneId: lane.id,
          bindingAuth,
          capability: "produce",
        });
        if (token) {
          verifyRemoteLaneToken({
            laneId: lane.id,
            bindingAuth,
            token,
            requiredCapability: "produce",
          });
        }

        const transportedPayload = roundTrip(emission.data);
        const resultPayload = await runInLocalSimulatedScope(lane, async () => {
          emission.data = transportedPayload;
          await next(emission);
          return emission.data;
        });
        emission.data = roundTrip(resultPayload);
      });
    }

    let exposure: { close: () => Promise<void> } | null = null;
    if (config.exposure?.http) {
      if (resolved.mode !== "network") {
        rpcLanesExposureModeError.throw({ mode: resolved.mode });
      }
      if (resolved.serveLaneIds.size > 0) {
        exposure = await createNodeExposure(
          { http: config.exposure.http },
          typedDependencies as NodeExposureDeps,
          {
            authorizeTask: async (req, taskId) => {
              const lane = resolved.taskLaneByTaskId.get(taskId);
              if (!lane || !resolved.serveLaneIds.has(lane.id)) {
                return null;
              }
              const binding = resolved.bindingsByLaneId.get(lane.id);
              return authorizeRpcLaneRequest(req, lane, binding?.auth);
            },
            authorizeEvent: async (req, eventId) => {
              const lane = resolved.eventLaneByEventId.get(eventId);
              if (!lane || !resolved.serveLaneIds.has(lane.id)) {
                return null;
              }
              const binding = resolved.bindingsByLaneId.get(lane.id);
              return authorizeRpcLaneRequest(req, lane, binding?.auth);
            },
          },
        );
      }
    }

    return toRpcLanesResourceValue(resolved, exposure);
  },
  async dispose(value) {
    if (value?.exposure) {
      await value.exposure.close();
    }
  },
});
