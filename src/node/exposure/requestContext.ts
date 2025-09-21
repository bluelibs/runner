import type { IncomingMessage, ServerResponse } from "http";
import { createContext, getCurrentStore } from "../../context";

export interface ExposureRequestContextValue {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  basePath: string;
  headers: IncomingMessage["headers"];
  method?: string;
  // Cancellation signal: flips to aborted when the client disconnects/aborts
  signal: AbortSignal;
}

export const ExposureRequestContext = createContext<ExposureRequestContextValue>(
  "platform.node.exposure.request",
);

export function useExposureContext(): ExposureRequestContextValue {
  return ExposureRequestContext.use();
}

/**
 * Checks if the exposure request context is currently available without throwing an error.
 * Useful for conditional logic in tasks that may or may not be exposed.
 */
export function hasExposureContext(): boolean {
  const store = getCurrentStore();
  if (!store) {
    return false;
  }
  return store.has(ExposureRequestContext.id);
}
