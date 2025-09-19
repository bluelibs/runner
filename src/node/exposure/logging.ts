import type { Logger } from "../../models/Logger";

export function safeLogError(
  logger: Logger,
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    logger.error(message, data);
  } catch {
    // Ignore logger failures
  }
}

export function safeLogInfo(
  logger: Logger,
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    logger.info(message, data);
  } catch {
    // Ignore logger failures
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
