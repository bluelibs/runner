import { Logger } from "./Logger";

export type UnhandledErrorKind =
  | "process"
  | "task"
  | "middleware"
  | "resourceInit"
  | "hook"
  | "run";

export interface OnUnhandledErrorInfo {
  error: unknown;
  kind?: UnhandledErrorKind;
  source?: string;
}

export type OnUnhandledError = (
  info: OnUnhandledErrorInfo,
) => void | Promise<void>;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function reportUnhandledErrorReporterFailure(
  reporterError: unknown,
  info: OnUnhandledErrorInfo,
): void {
  const normalizedReporterError = toError(reporterError);
  const normalizedOriginalError = toError(info.error);
  console.error("[runner] Failed to report unhandled error.", {
    reporterError: normalizedReporterError,
    originalError: normalizedOriginalError,
    kind: info.kind,
    source: info.source,
  });
}

export function createDefaultUnhandledError(logger: Logger): OnUnhandledError {
  return async ({ error, kind, source }: OnUnhandledErrorInfo) => {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));

    await logger.error(`${normalizedError.toString()}`, {
      source,
      error: normalizedError,
      data: {
        kind,
      },
    });
  };
}

export function bindProcessErrorHandler(
  handler: OnUnhandledError,
): (
  error: unknown,
  source: "uncaughtException" | "unhandledRejection",
) => void | Promise<void> {
  return async (error, source) => {
    try {
      await handler({ error, kind: "process", source });
    } catch (reporterError) {
      reportUnhandledErrorReporterFailure(reporterError, {
        error,
        kind: "process",
        source,
      });
    }
  };
}

export async function safeReportUnhandledError(
  handler: OnUnhandledError,
  info: OnUnhandledErrorInfo,
): Promise<void> {
  try {
    await handler(info);
  } catch (reporterError) {
    reportUnhandledErrorReporterFailure(reporterError, info);
  }
}
