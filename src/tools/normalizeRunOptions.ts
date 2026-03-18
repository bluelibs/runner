import { getPlatform } from "../platform";
import {
  ResolvedRunOptions,
  ResourceLifecycleMode,
  RunOptions,
} from "../types/runner";
import { detectRunnerMode } from "./detectRunnerMode";
import { resolveExecutionContextConfig } from "./resolveExecutionContextConfig";

export type NormalizedRunOptions = Omit<
  ResolvedRunOptions,
  "onUnhandledError"
> & {
  onUnhandledErrorInput?: ResolvedRunOptions["onUnhandledError"];
};

export function normalizeRunOptions(
  options: RunOptions | undefined,
): NormalizedRunOptions {
  const debug = options?.debug;
  const errorBoundary = options?.errorBoundary ?? true;
  const shutdownHooks = options?.shutdownHooks ?? true;
  const dispose = Object.freeze({
    totalBudgetMs: options?.dispose?.totalBudgetMs ?? 30_000,
    drainingBudgetMs: options?.dispose?.drainingBudgetMs ?? 20_000,
    cooldownWindowMs: options?.dispose?.cooldownWindowMs ?? 0,
  });
  const dryRun = options?.dryRun ?? false;
  const lazy = options?.lazy ?? false;
  const lifecycleMode =
    options?.lifecycleMode === ResourceLifecycleMode.Parallel
      ? ResourceLifecycleMode.Parallel
      : ResourceLifecycleMode.Sequential;
  const mode = detectRunnerMode(options?.mode);
  const logs = {
    printThreshold:
      options?.logs?.printThreshold ??
      (getPlatform().getEnv("NODE_ENV") === "test" ? null : "info"),
    printStrategy: options?.logs?.printStrategy ?? "pretty",
    bufferLogs: options?.logs?.bufferLogs ?? false,
  };

  return {
    debug,
    logs: Object.freeze(logs),
    errorBoundary,
    shutdownHooks,
    signal: options?.signal,
    dispose,
    onUnhandledErrorInput: options?.onUnhandledError,
    dryRun,
    executionContext: resolveExecutionContextConfig(options?.executionContext),
    identity: options?.identity ?? null,
    lazy,
    lifecycleMode,
    mode,
  };
}
