import { IEventLaneMeta } from "./meta";
import type { IEventDefinition } from "./event";
import type { IAsyncContext } from "./asyncContext";
import type { RemoteLaneBindingAuth } from "./remoteLaneAuth";
import { symbolEventLane, symbolFilePath } from "./utilities";

export interface IEventLaneDefinition {
  id: string;
  meta?: IEventLaneMeta;
  applyTo?:
    | readonly (IEventDefinition<any> | string)[]
    | ((event: IEventDefinition<any>) => boolean);
  asyncContexts?: readonly (IAsyncContext<unknown> | string)[];
  [symbolFilePath]?: string;
}

export interface IEventLane extends IEventLaneDefinition {
  id: string;
  meta: IEventLaneMeta;
  [symbolEventLane]: true;
  [symbolFilePath]: string;
}

export interface IEventLaneTopologyBinding {
  lane: IEventLaneDefinition;
  auth?: RemoteLaneBindingAuth;
}

export interface IEventLaneTopologyProfile<
  TLane extends IEventLaneDefinition = IEventLaneDefinition,
> {
  consume: readonly TLane[];
}

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
