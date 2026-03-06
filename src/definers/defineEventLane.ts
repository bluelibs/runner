import {
  IEventLane,
  IEventLaneDefinition,
  symbolEventLane,
  symbolFilePath,
} from "../defs";
import { eventLaneInvalidIdError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";
import { assertDefinitionId } from "./assertDefinitionId";

export function defineEventLane(config: IEventLaneDefinition): IEventLane {
  if (typeof config.id !== "string" || config.id.trim().length === 0) {
    eventLaneInvalidIdError.throw({ id: String(config.id) });
  }
  const callerFilePath = getCallerFile();
  assertDefinitionId("eventLane", config.id, {
    callerFilePath: callerFilePath,
  });
  return deepFreeze({
    ...config,
    id: config.id,
    meta: config.meta ?? {},
    [symbolFilePath]: callerFilePath,
    [symbolEventLane]: true,
  });
}
