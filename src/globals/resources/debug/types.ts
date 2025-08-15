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
  /**
   * Events marked with system are hidden by default.
   */
  logEventEmissionOnRun: boolean;
  logEventEmissionInput: boolean;
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
  logEventEmissionOnRun: false,
  logEventEmissionInput: false,
  logResourceOnError: false,
  logTaskOnError: false,
};

export const levelNormal: DebugConfig = {
  ...allFalse,
  logTaskAfterRun: true,
  logTaskBeforeRun: true,
  logResourceBeforeRun: true,
  logResourceAfterRun: true,
  logResourceOnError: true,
  logTaskOnError: true,
  logEventEmissionOnRun: true,
};

export const levelVerbose: DebugConfig = {
  ...levelNormal,
  logTaskInput: true,
  logTaskResult: true,
  logResourceConfig: true,
  logResourceResult: true,
  logEventEmissionInput: true,
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
