import { RunnerMode } from "../types/runner";
import { getPlatform } from "../platform";

// Keep resolved modes typed as the existing enum for downstream consumers.
const explicitModes = Object.freeze({
  test: RunnerMode.TEST,
  dev: RunnerMode.DEV,
  "pre-prod": RunnerMode.PRE_PROD,
  prod: RunnerMode.PROD,
});

/**
 * Detects the runner mode based on environment variables.
 * If no mode is explicitly provided, it will auto-detect from NODE_ENV.
 *
 * @param explicitMode - Optional mode to use if provided (takes precedence over environment)
 * @returns The detected runner mode
 */
export function detectRunnerMode(
  explicitMode?: RunnerMode | `${RunnerMode}`,
): RunnerMode {
  if (explicitMode !== undefined) {
    return explicitModes[explicitMode];
  }

  // Auto-detect mode from environment when not specified using platform adapter
  const env = getPlatform().getEnv("NODE_ENV");
  switch (env) {
    case "test":
      return RunnerMode.TEST;
    case "production":
      return RunnerMode.PROD;
    case "pre-prod":
      return RunnerMode.PRE_PROD;
    case "development":
    default:
      return RunnerMode.DEV;
  }
}
