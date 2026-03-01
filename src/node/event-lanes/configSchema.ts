import type { IValidationSchema } from "../../defs";
import { Match } from "../../tools/check";
import type { EventLanesResourceConfig } from "./types";
import {
  remoteLaneBindingAuthPattern,
  remoteLanesModePattern,
} from "../remote-lanes/configPatterns";

const laneReferenceShapePattern = Match.ObjectIncluding({
  id: String,
});

const laneReferencePattern = laneReferenceShapePattern;

const eventLaneQueueReferencePattern = Match.Any;

const eventLanesProfilePattern = Match.ObjectIncluding({
  consume: Match.ArrayOf(laneReferencePattern),
});

const eventLanesResourceConfigPattern = Match.ObjectIncluding({
  profile: String,
  topology: Match.ObjectIncluding({
    profiles: Match.RecordOf(eventLanesProfilePattern),
    bindings: Match.ArrayOf(
      Match.ObjectIncluding({
        lane: laneReferencePattern,
        queue: eventLaneQueueReferencePattern,
        auth: Match.Optional(remoteLaneBindingAuthPattern),
        prefetch: Match.Optional(Number),
        maxAttempts: Match.Optional(Number),
        retryDelayMs: Match.Optional(Number),
      }),
    ),
    relaySourcePrefix: Match.Optional(String),
  }),
  mode: Match.Optional(remoteLanesModePattern),
});

export const eventLanesResourceConfigSchema: IValidationSchema<EventLanesResourceConfig> =
  eventLanesResourceConfigPattern;
