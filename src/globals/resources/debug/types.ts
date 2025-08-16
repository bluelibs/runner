import { ITaggable } from "../../../defs";
import { debugTag } from "./debug.tag";

export type DebugConfig = {
  logResourceConfig: boolean;
  logResourceResult: boolean;
  logResourceBeforeRun: boolean;
  logResourceAfterRun: boolean;
  logResourceOnError: boolean;
  logTaskBeforeRun: boolean;
  logTaskInput: boolean;
  logTaskResult: boolean;
  logTaskAfterRun: boolean;
  logTaskOnError: boolean;
  logMiddlewareBeforeRun: boolean;
  logMiddlewareAfterRun: boolean;
  logEventEmissionOnRun: boolean;
  logEventEmissionInput: boolean;
  /**
   * Events marked with system are hidden by default.
   */
  logHookTriggered: boolean;
  logHookCompleted: boolean;
};

export const allFalse: DebugConfig = {
  logResourceBeforeRun: false,
  logResourceAfterRun: false,
  logMiddlewareBeforeRun: false,
  logMiddlewareAfterRun: false,
  logTaskBeforeRun: false,
  logTaskAfterRun: false,
  logTaskInput: false,
  logTaskResult: false,
  logResourceConfig: false,
  logResourceResult: false,
  logResourceOnError: false,
  logTaskOnError: false,
  logHookTriggered: false,
  logHookCompleted: false,
  logEventEmissionOnRun: false,
  logEventEmissionInput: false,
};

export const levelNormal: DebugConfig = {
  ...allFalse,
  logTaskAfterRun: true,
  logTaskBeforeRun: true,
  logResourceBeforeRun: true,
  logResourceAfterRun: true,
  logResourceOnError: true,
  logTaskOnError: true,
  logHookTriggered: true,
  logHookCompleted: true,
  logEventEmissionOnRun: true,
  logEventEmissionInput: true,
};

export const levelVerbose: DebugConfig = {
  ...levelNormal,
  logTaskInput: true,
  logTaskResult: true,
  logResourceConfig: true,
  logResourceResult: true,
  logHookTriggered: true,
  logHookCompleted: true,
};

export type DebugFriendlyConfig = "normal" | "verbose" | DebugConfig;

export const getConfig = (
  config: DebugFriendlyConfig,
  taggable?: ITaggable
): DebugConfig => {
  if (taggable) {
    const debugLocal = debugTag.extract(taggable);

    if (debugLocal) {
      return getConfig(debugLocal.config);
    }
  }
  if (config === "normal") {
    return levelNormal;
  }
  if (config === "verbose") {
    return levelVerbose;
  }
  return config;
};
