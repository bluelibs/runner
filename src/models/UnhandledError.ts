import { Logger } from "./Logger";

export interface OnUnhandledErrorArgs {
  logger: Logger;
  error: unknown;
}

export type OnUnhandledError = (
  args: OnUnhandledErrorArgs
) => void | Promise<void>;

export async function defaultUnhandledError({
  logger,
  error,
}: OnUnhandledErrorArgs): Promise<void> {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  await logger.error("Unhandled error", { error: normalizedError });
}

export function bindProcessErrorHandler(
  onUnhandledError: OnUnhandledError,
  logger: Logger
): (
  error: unknown,
  source: "uncaughtException" | "unhandledRejection"
) => void | Promise<void> {
  return async (error) => {
    try {
      await onUnhandledError({ logger, error });
    } catch {}
  };
}

export async function safeReportUnhandledError(
  onUnhandledError: OnUnhandledError,
  logger: Logger,
  error: unknown
): Promise<void> {
  try {
    await onUnhandledError({ logger, error });
  } catch {}
}
