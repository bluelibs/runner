import { RunnerMode } from "../enums/RunnerMode";
import { getPlatform } from "../platform";

/**
 * Detects the runner mode based on environment variables.
 * If no mode is explicitly provided, it will auto-detect from NODE_ENV.
 * 
 * @param explicitMode - Optional mode to use if provided (takes precedence over environment)
 * @returns The detected runner mode
 */
export function detectRunnerMode(explicitMode?: RunnerMode): RunnerMode {
  if (explicitMode !== undefined) {
    return explicitMode;
  }

  // Auto-detect mode from environment when not specified using platform adapter
  const env = getPlatform().getEnv("NODE_ENV");
  switch (env) {
    case 'test':
      return RunnerMode.TEST;
    case 'production':
      return RunnerMode.PROD;
    case 'development':
    default:
      return RunnerMode.DEV;
  }
}