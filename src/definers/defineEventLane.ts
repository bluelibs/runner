import {
  IEventLane,
  IEventLaneDefinition,
  symbolEventLane,
  symbolFilePath,
} from "../defs";
import { eventLaneInvalidIdError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";

export function defineEventLane(config: IEventLaneDefinition): IEventLane {
  if (typeof config.id !== "string" || config.id.trim().length === 0) {
    eventLaneInvalidIdError.throw({ id: String(config.id) });
  }

  const callerFilePath = getCallerFile();
  return deepFreeze({
    ...config,
    id: config.id,
    meta: config.meta ?? {},
    [symbolFilePath]: callerFilePath,
    [symbolEventLane]: true,
  });
}
