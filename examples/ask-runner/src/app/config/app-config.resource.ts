import path from "path";

import { r } from "@bluelibs/runner";

import { missingConfigError } from "../errors";
import { loadEnvFile, resolveEnvFilePath } from "./env-file";

export interface AskRunnerPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export interface AskRunnerConfig {
  openAiApiKey: string;
  openAiApiUrl: string | null;
  adminSecret: string;
  host: string;
  port: number;
  sqlitePath: string;
  dailyBudgetUsd: number;
  trustProxy: boolean;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  rateLimitPerDay: number;
  maxConcurrentOpenAiCalls: number;
  maxInputChars: number;
  model: string;
  maxOutputTokens: number;
  tokenCharsEstimate: number;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  serviceTier: "auto" | "default" | "flex" | "priority";
  pricing: AskRunnerPricing;
}

export const appConfig = r
  .resource("config")
  .init(async (): Promise<AskRunnerConfig> => {
    const env = {
      ...loadEnvFile(resolveEnvFilePath()),
      ...process.env,
    };

    return {
      openAiApiKey: requiredEnv(env, "OPENAI_API_KEY"),
      openAiApiUrl: optionalEnv(env, "OPENAI_API_URL"),
      adminSecret: requiredEnv(env, "ASK_RUNNER_ADMIN_SECRET"),
      host: getEnv(env, "ASK_RUNNER_HOST", "127.0.0.1"),
      port: portEnv(env, "ASK_RUNNER_PORT", 3010),
      sqlitePath: path.resolve(
        process.cwd(),
        getEnv(env, "ASK_RUNNER_SQLITE_PATH", "./ask-runner.db"),
      ),
      dailyBudgetUsd: numberEnvFallback(
        env,
        ["MAXIMUM_DAILY_BUDGET", "ASK_RUNNER_DAILY_BUDGET_USD"],
        5,
      ),
      trustProxy: booleanEnv(env, "ASK_RUNNER_TRUST_PROXY", true),
      rateLimitPerMinute: integerEnv(env, "ASK_RUNNER_RATE_LIMIT_PER_MINUTE", 5),
      rateLimitPerHour: integerEnv(env, "ASK_RUNNER_RATE_LIMIT_PER_HOUR", 60),
      rateLimitPerDay: integerEnv(env, "ASK_RUNNER_RATE_LIMIT_PER_DAY", 100),
      maxConcurrentOpenAiCalls: integerEnv(
        env,
        "ASK_RUNNER_MAX_CONCURRENT_OPENAI_CALLS",
        2,
      ),
      maxInputChars: integerEnv(env, "ASK_RUNNER_MAX_INPUT_CHARS", 1000),
      model: getEnv(env, "ASK_RUNNER_MODEL", "gpt-5.4"),
      maxOutputTokens: integerEnv(env, "ASK_RUNNER_MAX_OUTPUT_TOKENS", 10000),
      tokenCharsEstimate: integerEnv(env, "ASK_RUNNER_TOKEN_CHARS_ESTIMATE", 4),
      reasoningEffort: reasoningEnv(env, "ASK_RUNNER_REASONING_EFFORT", "low"),
      serviceTier: serviceTierEnv(env, "ASK_RUNNER_SERVICE_TIER", "priority"),
      pricing: {
        inputPer1M: numberEnv(env, "ASK_RUNNER_PRICE_INPUT_PER_1M", 0.25),
        cachedInputPer1M: numberEnv(
          env,
          "ASK_RUNNER_PRICE_CACHED_INPUT_PER_1M",
          0.025,
        ),
        outputPer1M: numberEnv(env, "ASK_RUNNER_PRICE_OUTPUT_PER_1M", 2),
      },
    };
  })
  .build();

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    missingConfigError.throw({
      message: `Missing required environment variable ${name}.`,
    });
  }

  return value as string;
}

function getEnv(env: Record<string, string | undefined>, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function optionalEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function integerEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    missingConfigError.throw({
      message: `Environment variable ${name} must be a positive integer.`,
    });
  }

  return parsed;
}

function portEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    missingConfigError.throw({
      message: `Environment variable ${name} must be a non-negative integer.`,
    });
  }

  return parsed;
}

function numberEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    missingConfigError.throw({
      message: `Environment variable ${name} must be a non-negative number.`,
    });
  }

  return parsed;
}

function numberEnvFallback(
  env: Record<string, string | undefined>,
  names: string[],
  fallback: number,
): number {
  for (const name of names) {
    const raw = env[name];
    if (raw !== undefined && raw.trim() !== "") {
      return numberEnv(env, name, fallback);
    }
  }

  return fallback;
}

function booleanEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  if (raw === "true") return true;
  if (raw === "false") return false;

  missingConfigError.throw({
    message: `Environment variable ${name} must be true or false.`,
  });
  return fallback;
}

function reasoningEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: AskRunnerConfig["reasoningEffort"],
): AskRunnerConfig["reasoningEffort"] {
  const value = getEnv(env, name, fallback);
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") {
    return value;
  }

  missingConfigError.throw({
    message: `Environment variable ${name} must be one of minimal|low|medium|high.`,
  });
  return fallback;
}

function serviceTierEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: AskRunnerConfig["serviceTier"],
): AskRunnerConfig["serviceTier"] {
  const value = getEnv(env, name, fallback);
  if (value === "auto" || value === "default" || value === "flex" || value === "priority") {
    return value;
  }

  missingConfigError.throw({
    message: `Environment variable ${name} must be one of auto|default|flex|priority.`,
  });
  return fallback;
}
