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

export const allFalse: DebugConfig = Object.freeze({
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

export const levelNormal: DebugConfig = Object.freeze({
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
  logEventEmissionInput: true,
});

Object.freeze(levelNormal);

export const levelVerbose: DebugConfig = Object.freeze({
  ...levelNormal,
  logTaskInput: true,
  logTaskOutput: true,
  logResourceConfig: true,
  logResourceValue: true,
  logHookTriggered: true,
  logHookCompleted: true,
});

Object.freeze(levelVerbose);

export type DebugFriendlyConfig = "normal" | "verbose" | DebugConfig;

export const getConfig = (
  config: DebugFriendlyConfig,
  taggable?: ITaggable,
): DebugConfig => {
  if (taggable) {
    const debugLocal = debugTag.extract(taggable);

    if (debugLocal) {
      return getConfig(debugLocal.config);
    }
  }
  if (config === "normal") {
    return { ...levelNormal };
  }
  if (config === "verbose") {
    return { ...levelVerbose };
  }
  return { ...(config as DebugConfig) };
};
