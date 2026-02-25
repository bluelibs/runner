import { IEventLaneMeta } from "./meta";
import { symbolEventLane, symbolFilePath } from "./utilities";

export interface IEventLaneDefinition {
  id: string;
  meta?: IEventLaneMeta;
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
}

export interface IEventLaneTopologyProfile<
  TLane extends IEventLaneDefinition = IEventLaneDefinition,
> {
  consume: readonly TLane[];
  durableWorker?: boolean;
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
