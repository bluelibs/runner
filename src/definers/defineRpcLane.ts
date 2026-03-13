import {
  IRpcLane,
  IRpcLaneDefinition,
  symbolFilePath,
  symbolRpcLane,
} from "../defs";
import { rpcLaneInvalidIdError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";
import { assertDefinitionId } from "./assertDefinitionId";

/**
 * Defines an RPC lane.
 *
 * RPC lanes describe how tagged tasks and events resolve to remote transport profiles.
 */
export function defineRpcLane(config: IRpcLaneDefinition): IRpcLane {
  if (typeof config.id !== "string" || config.id.trim().length === 0) {
    rpcLaneInvalidIdError.throw({ id: String(config.id) });
  }
  const callerFilePath = getCallerFile();
  assertDefinitionId("rpcLane", config.id);
  return deepFreeze({
    ...config,
    id: config.id,
    meta: config.meta ?? {},
    [symbolFilePath]: callerFilePath,
    [symbolRpcLane]: true,
  });
}
