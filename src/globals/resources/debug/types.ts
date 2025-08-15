export type DebugConfig = {
  logTaskInput: boolean;
  logTaskResult: boolean;
  logResourceConfig: boolean;
  logResourceResult: boolean;
  logTaskBeforeRun: boolean;
  logTaskAfterRun: boolean;
  logResourceBeforeRun: boolean;
  logResourceAfterRun: boolean;
  logMiddlewareBeforeRun: boolean;
  logMiddlewareAfterRun: boolean;
};

export const defaultDebugConfig: DebugConfig = {
  logTaskBeforeRun: false,
  logTaskAfterRun: false,
  logResourceBeforeRun: false,
  logResourceAfterRun: false,
  logMiddlewareBeforeRun: false,
  logMiddlewareAfterRun: false,
  logTaskInput: false,
  logTaskResult: false,
  logResourceConfig: false,
  logResourceResult: false,
};

export type DebugFriendlyConfig = boolean | DebugConfig;
