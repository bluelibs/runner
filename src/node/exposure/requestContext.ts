import type { IncomingMessage, ServerResponse } from "http";
import { createContext } from "../../context";

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
