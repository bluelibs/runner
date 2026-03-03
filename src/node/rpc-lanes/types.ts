import type {
  IRpcLaneCommunicator,
  IRpcLanesTopology,
  IRpcLaneTopologyProfile,
} from "../../defs";
import type { NodeExposureHttpConfig } from "../exposure/resourceTypes";
import type { NodeExposureHandlers } from "../exposure/resourceTypes";
import type { RemoteLanesMode } from "../remote-lanes/mode";

export type RpcLanesTopology = IRpcLanesTopology;

export type RpcLanesProfileConfig = IRpcLaneTopologyProfile;

export type RpcLanesProfileId<TTopology extends RpcLanesTopology> = Extract<
  keyof TTopology["profiles"],
  string
>;

export interface RpcLanesResourceConfig<
  TTopology extends RpcLanesTopology = RpcLanesTopology,
  TProfile extends RpcLanesProfileId<TTopology> = RpcLanesProfileId<TTopology>,
> {
  profile: TProfile;
  topology: TTopology;
  mode?: RemoteLanesMode;
  exposure?: {
    http?: NodeExposureHttpConfig;
  };
}

export interface RpcLanesResourceValue {
  profile: string;
  mode: RemoteLanesMode;
  serveTaskIds: readonly string[];
  serveEventIds: readonly string[];
  taskAllowAsyncContext: Readonly<Record<string, boolean>>;
  eventAllowAsyncContext: Readonly<Record<string, boolean>>;
  taskAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
  eventAsyncContextAllowList: Readonly<Record<string, readonly string[]>>;
  communicatorByLaneId: ReadonlyMap<string, IRpcLaneCommunicator>;
  exposure?: {
    close: () => Promise<void>;
    getHandlers?: () => NodeExposureHandlers | null;
  } | null;
}
