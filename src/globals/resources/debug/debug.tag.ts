import { defineTag } from "../../../definers/defineTag";
import { DebugFriendlyConfig } from "./types";
import { Match } from "../../../tools/check";

const debugConfigPattern = Match.ObjectIncluding({
  logResourceConfig: Match.Optional(Boolean),
  logResourceValue: Match.Optional(Boolean),
  logResourceBeforeRun: Match.Optional(Boolean),
  logResourceAfterRun: Match.Optional(Boolean),
  logTaskBeforeRun: Match.Optional(Boolean),
  logTaskInput: Match.Optional(Boolean),
  logTaskOutput: Match.Optional(Boolean),
  logTaskAfterRun: Match.Optional(Boolean),
  logMiddlewareBeforeRun: Match.Optional(Boolean),
  logMiddlewareAfterRun: Match.Optional(Boolean),
  logEventEmissionOnRun: Match.Optional(Boolean),
  logEventEmissionInput: Match.Optional(Boolean),
  logHookTriggered: Match.Optional(Boolean),
  logHookCompleted: Match.Optional(Boolean),
});

const debugFriendlyConfigPattern = Match.OneOf(
  "normal",
  "verbose",
  debugConfigPattern,
);

export const debugTag = defineTag<DebugFriendlyConfig>({
  id: "debug",
  configSchema: debugFriendlyConfigPattern,
  meta: {
    title: "Debug",
    description:
      "Debug-specific tags. Used for filtering out noise when you're focusing on your application.",
  },
});
