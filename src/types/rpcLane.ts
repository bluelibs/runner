import type { IResource } from "./resource";
import type { IRpcLaneMeta } from "./meta";
import type { IEventDefinition } from "./event";
import type { ITaskDefinition } from "./task";
import { symbolFilePath, symbolRpcLane } from "./utilities";

export interface IRpcLaneDefinition {
  id: string;
  meta?: IRpcLaneMeta;
  applyTo?: readonly (ITaskDefinition<any> | IEventDefinition<any> | string)[];
  [symbolFilePath]?: string;
}

export interface IRpcLane extends IRpcLaneDefinition {
  id: string;
  meta: IRpcLaneMeta;
  [symbolRpcLane]: true;
  [symbolFilePath]: string;
}

export interface IRpcLaneCommunicator {
  task?(id: string, input?: unknown): Promise<unknown>;
  event?(id: string, payload?: unknown): Promise<void>;
  eventWithResult?(id: string, payload?: unknown): Promise<unknown>;
}

export type RpcLaneCommunicatorResource = IResource<
  any,
  Promise<any>,
  any,
  any,
  any,
  any,
  any
>;

export interface IRpcLaneTopologyBinding {
  lane: IRpcLaneDefinition;
  communicator: RpcLaneCommunicatorResource;
  allowAsyncContext?: boolean;
}

export interface IRpcLaneTopologyProfile<
  TLane extends IRpcLaneDefinition = IRpcLaneDefinition,
> {
  serve: readonly TLane[];
}

export interface IRpcLanesTopology<
  TBindings extends readonly IRpcLaneTopologyBinding[] =
    readonly IRpcLaneTopologyBinding[],
  TProfiles extends Record<
    string,
    IRpcLaneTopologyProfile<TBindings[number]["lane"]>
  > = Record<string, IRpcLaneTopologyProfile<TBindings[number]["lane"]>>,
> {
  profiles: TProfiles;
  bindings: TBindings;
}
