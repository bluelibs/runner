import { IEventLaneMeta } from "./meta";
import type { IEventDefinition } from "./event";
import type { IAsyncContext } from "./asyncContext";
import type { IHook } from "./hook";
import type { RemoteLaneBindingAuth } from "./remoteLaneAuth";
import { symbolEventLane, symbolFilePath } from "./utilities";

/**
 * Definition contract for an event lane.
 */
export interface IEventLaneDefinition {
  id: string;
  meta?: IEventLaneMeta;
  applyTo?:
    | readonly (IEventDefinition<any> | string)[]
    | ((event: IEventDefinition<any>) => boolean);
  /**
   * Async contexts allowed to cross this lane during relay.
   * Defaults to an empty allowlist, meaning no async contexts are forwarded.
   */
  asyncContexts?: readonly (IAsyncContext<unknown> | string)[];
  [symbolFilePath]?: string;
}

/**
 * Frozen event-lane definition returned by `defineEventLane(...)`.
 */
export interface IEventLane extends IEventLaneDefinition {
  id: string;
  meta: IEventLaneMeta;
  [symbolEventLane]: true;
  [symbolFilePath]: string;
}

/**
 * One externally consumable event-lane binding in a topology.
 */
export interface IEventLaneTopologyBinding {
  lane: IEventLaneDefinition;
  auth?: RemoteLaneBindingAuth;
}

/**
 * Optional relay hook policy applied by a consuming profile for one lane.
 */
export interface IEventLaneTopologyHookPolicy {
  /**
   * Allowlist of hooks that may run for relay re-emits consumed from this lane.
   * Omit to allow all matching hooks.
   */
  only?: readonly IHook[];
}

/**
 * One consumed event-lane entry for a specific profile.
 */
export interface IEventLaneTopologyConsumeEntry<
  TLane extends IEventLaneDefinition = IEventLaneDefinition,
> {
  lane: TLane;
  hooks?: IEventLaneTopologyHookPolicy;
}

/**
 * Named event-lane profile listing the lanes a consumer should subscribe to.
 */
export interface IEventLaneTopologyProfile<
  TLane extends IEventLaneDefinition = IEventLaneDefinition,
> {
  consume: readonly IEventLaneTopologyConsumeEntry<TLane>[];
}

/**
 * Event-lane topology declaration used by remote/event-lane integrations.
 */
export interface IEventLaneTopology<
  TBindings extends readonly IEventLaneTopologyBinding[] =
    readonly IEventLaneTopologyBinding[],
  TProfiles extends Record<
    string,
    IEventLaneTopologyProfile<TBindings[number]["lane"]>
  > = Record<string, IEventLaneTopologyProfile<TBindings[number]["lane"]>>,
> {
  profiles: TProfiles;
  bindings: TBindings;
  relaySourcePrefix?: string;
}
