import { defineFrameworkResource } from "../../../definers/frameworkDefinition";
import { DebugFriendlyConfig, getConfig } from "./types";
import { globalTags } from "../../../globals/globalTags";
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

export const debugConfig = defineFrameworkResource({
  id: "runner.debug.resources.config",
  configSchema: debugFriendlyConfigPattern,
  meta: {
    title: "Debug Config",
    description: "Debug config. This is used to debug the system.",
  },
  tags: [globalTags.system],
  init: async (config: DebugFriendlyConfig) => {
    const myConfig = { ...getConfig(config) };

    Object.freeze(myConfig);
    return myConfig;
  },
});
