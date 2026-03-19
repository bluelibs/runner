import type {
  IRpcLaneCommunicator,
  IRpcLanesTopology,
  IRpcLaneTopologyProfile,
  IResource,
} from "../../defs";
import type {
  NodeExposureHandlers,
  NodeExposureHttpConfig,
} from "../exposure/resourceTypes";
import type { RemoteLanesMode } from "../remote-lanes/mode";
import type { ExposureRequestContextValue } from "../exposure/requestContext";
import type { Serializer } from "../../serializer";

export type RpcLanesTopology = IRpcLanesTopology;

export type RpcLanesProfileConfig = IRpcLaneTopologyProfile;

export type RpcLanesProfileId<TTopology extends RpcLanesTopology> = Extract<
  keyof TTopology["profiles"],
  string
>;

type SerializerResourceDefinition = IResource<
  any,
  Promise<Serializer>,
  any,
  any,
  any,
  any,
  any
>;

export type RpcLanesSerializerResource = SerializerResourceDefinition;
export type RpcLanesSerializerReference = RpcLanesSerializerResource;

export interface RpcLanesResourceConfig<
  TTopology extends RpcLanesTopology = RpcLanesTopology,
  TProfile extends RpcLanesProfileId<TTopology> = RpcLanesProfileId<TTopology>,
> {
  profile: TProfile;
  topology: TTopology;
  /**
   * Optional serializer resource used for RPC payload boundaries and async
   * context header transport. Configure it at registration time and pass the
   * bare resource definition here. Defaults to `resources.serializer`.
   */
  serializer?: RpcLanesSerializerReference;
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

export type RpcLaneRequestContextValue = ExposureRequestContextValue;
