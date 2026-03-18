import type { IValidationSchema } from "../../defs";
import { isHook } from "../../define";
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
const hookReferencePattern = Match.Where(isHook, "Expected Hook definition.");

const eventLaneQueueReferencePattern = Match.Any;
const eventLaneConsumeEntryPattern = Match.ObjectIncluding({
  lane: laneReferencePattern,
  hooks: Match.Optional(
    Match.ObjectIncluding({
      only: Match.Optional(Match.ArrayOf(hookReferencePattern)),
    }),
  ),
});

const eventLanesProfilePattern = Match.ObjectIncluding({
  consume: Match.ArrayOf(eventLaneConsumeEntryPattern),
});

const eventLanesResourceConfigPattern = Match.ObjectIncluding({
  profile: String,
  topology: Match.ObjectIncluding({
    profiles: Match.MapOf(eventLanesProfilePattern),
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
