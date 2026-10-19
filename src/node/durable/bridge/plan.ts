import { collectCrossLaneApplyToEventIds } from "../../remote-lanes/laneAssignmentUtils";
import {
  collectEventTopologyLanes,
  collectRpcTopologyLanes,
} from "../../remote-lanes/topologyLanes";
import { eventLanesResource } from "../../event-lanes/eventLanes.resource";
import { rpcLanesResource } from "../../rpc-lanes/rpcLanes.resource";
import type { Store } from "../../../models/store/Store";
import type { EventManager } from "../../../models/EventManager";
import type { IEvent } from "../../../types/event";
import type { IListenerStorage } from "../../../models/event/types";
import { globalEvents } from "../../../globals/globalEvents";
import { isSameDefinition } from "../../../tools/isSameDefinition";
import { durableEventsArray } from "../events";
import { durableEventTag } from "./tag";
import type { DurableEventBridgeConfig, DurableEventConfig } from "./types";
import { durableExecutionInvariantError } from "../../../errors";

export function bridgeError(message: string): never {
  return durableExecutionInvariantError.throw({ message });
}

export function eventPolicy(
  event: IEvent<any>,
  config: DurableEventBridgeConfig,
): DurableEventConfig | undefined {
  const tagged = durableEventTag.exists(event);
  const policy = durableEventTag.extract(event) ?? {};
  if (policy.enabled === false) return undefined;
  const infrastructure = [
    ...Object.values(globalEvents),
    ...durableEventsArray,
  ].some((definition) => isSameDefinition(definition, event));
  if (infrastructure) {
    if (tagged)
      bridgeError(`Infrastructure event '${event.id}' cannot be durable.`);
    return undefined;
  }
  const selector = config.applyTo;
  const selected =
    tagged ||
    selector === "all" ||
    (typeof selector === "function"
      ? selector(event)
      : selector?.some((definition) => isSameDefinition(definition, event)));
  if (!selected) return undefined;
  if (event.parallel || event.transactional)
    bridgeError(
      `Durable event '${event.id}' must be sequential and use registered compensation instead of undo closures.`,
    );
  return policy;
}

export function eventHooks(
  store: Store,
  manager: EventManager,
  event: IEvent<any>,
  compensate: boolean,
): readonly IListenerStorage[] {
  const listeners = manager.getDispatchListeners(event);
  for (const listener of listeners) {
    const hook = listener.id ? store.hooks.get(listener.id)?.hook : undefined;
    if (!hook || listener.isGlobal || listener.filter)
      bridgeError(
        `Durable event '${event.id}' requires named exact-event hooks.`,
      );
    const targets = store.resolveHookTargets(hook!);
    if (targets.some((target) => target.provenance !== "exact"))
      bridgeError(`Durable hook '${hook!.id}' cannot use selector targets.`);
    if (compensate && !hook!.compensate)
      bridgeError(`Durable hook '${hook!.id}' must declare compensate().`);
  }
  return listeners;
}

/** Rejects competing transport owners before either can dispatch hooks. */
export function assertNoLaneRoute(store: Store, eventId: string): void {
  const eventIds = collectCrossLaneApplyToEventIds(
    store,
    eventLanesResource,
    (topology) =>
      collectEventTopologyLanes(
        topology as Parameters<typeof collectEventTopologyLanes>[0],
      ),
  );
  const rpcIds = collectCrossLaneApplyToEventIds(
    store,
    rpcLanesResource,
    (topology) =>
      collectRpcTopologyLanes(
        topology as Parameters<typeof collectRpcTopologyLanes>[0],
      ),
  );
  if (eventIds.has(eventId) || rpcIds.has(eventId))
    bridgeError(
      `Durable event '${eventId}' cannot also be assigned to a remote lane.`,
    );
}
