import { ITaggable } from "../../../defs";
import { debugTag } from "./debug.tag";

export type DebugConfig = {
  logResourceConfig: boolean;
  logResourceValue: boolean;
  logResourceBeforeRun: boolean;
  logResourceAfterRun: boolean;
  logTaskBeforeRun: boolean;
  logTaskInput: boolean;
  logTaskOutput: boolean;
  logTaskAfterRun: boolean;
  logMiddlewareBeforeRun: boolean;
  logMiddlewareAfterRun: boolean;
  logEventEmissionOnRun: boolean;
  logEventEmissionInput: boolean;
  logHookTriggered: boolean;
  logHookCompleted: boolean;
};

const allFalse: DebugConfig = Object.freeze({
  logResourceBeforeRun: false,
  logResourceAfterRun: false,
  logMiddlewareBeforeRun: false,
  logMiddlewareAfterRun: false,
  logTaskBeforeRun: false,
  logTaskAfterRun: false,
  logTaskInput: false,
  logTaskOutput: false,
  logResourceConfig: false,
  logResourceValue: false,
  logHookTriggered: false,
  logHookCompleted: false,
  logEventEmissionOnRun: false,
  logEventEmissionInput: false,
});

const levelNormal: DebugConfig = Object.freeze({
  ...allFalse,
  logTaskAfterRun: true,
  logTaskBeforeRun: true,
  logResourceBeforeRun: true,
  logResourceAfterRun: true,
  logMiddlewareBeforeRun: true,
  logMiddlewareAfterRun: true,
  logHookTriggered: true,
  logHookCompleted: true,
  logEventEmissionOnRun: true,
});

Object.freeze(levelNormal);

const levelVerbose: DebugConfig = Object.freeze({
  ...levelNormal,
  logTaskInput: true,
  logTaskOutput: true,
  logResourceConfig: true,
  logResourceValue: true,
  logHookTriggered: true,
  logHookCompleted: true,
});

Object.freeze(levelVerbose);

/**
 * If you choose to specify your own config, all values will be set to false by default and extended by your config.
 */
export type DebugFriendlyConfig = "normal" | "verbose" | Partial<DebugConfig>;

function formatConfig(config: DebugFriendlyConfig): DebugConfig {
  if (config === "normal") {
    return { ...levelNormal };
  }
  if (config === "verbose") {
    return { ...levelVerbose };
  }
  return { ...allFalse, ...config };
}

export const getConfig = (
  config: DebugFriendlyConfig,
  taggable?: ITaggable,
): DebugConfig => {
  if (!taggable) {
    return formatConfig(config);
  }
  const debugTagConfig = debugTag.extract(taggable);

  if (debugTagConfig) {
    const debugTagConfigFormatted = formatConfig(debugTagConfig);
    return { ...formatConfig(config), ...debugTagConfigFormatted };
  }

  return formatConfig(config);
};
