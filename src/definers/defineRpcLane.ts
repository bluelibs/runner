import {
  IRpcLane,
  IRpcLaneDefinition,
  symbolFilePath,
  symbolRpcLane,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";

export function defineRpcLane(config: IRpcLaneDefinition): IRpcLane {
  const callerFilePath = getCallerFile();
  return deepFreeze({
    ...config,
    id: config.id,
    meta: config.meta ?? {},
    [symbolFilePath]: callerFilePath,
    [symbolRpcLane]: true,
  });
}
