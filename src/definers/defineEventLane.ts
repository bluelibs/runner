import {
  IEventLane,
  IEventLaneDefinition,
  symbolEventLane,
  symbolFilePath,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";

export function defineEventLane(config: IEventLaneDefinition): IEventLane {
  const callerFilePath = getCallerFile();
  return deepFreeze({
    ...config,
    id: config.id,
    meta: config.meta ?? {},
    [symbolFilePath]: callerFilePath,
    [symbolEventLane]: true,
  });
}
