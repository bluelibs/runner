import type { NodeExposureHandlers } from "@bluelibs/runner/node";

import { HttpConfig, Protocol } from "../ids.js";

enum ErrorMessage {
  MissingServer = "Exposure server not available",
  MissingAddress = "Exposure server address missing",
  PipeNotSupported = "Pipe address not supported",
}

export function getExposureBaseUrl(handlers: NodeExposureHandlers): string {
  const server = handlers.server;
  if (!server) {
    throw new Error(ErrorMessage.MissingServer);
  }
  const address = server.address();
  if (!address) {
    throw new Error(ErrorMessage.MissingAddress);
  }
  if (typeof address === "string") {
    throw new Error(ErrorMessage.PipeNotSupported);
  }

  const basePath = handlers.basePath.endsWith("/")
    ? handlers.basePath.slice(0, -1)
    : handlers.basePath;

  return `${Protocol.Http}${HttpConfig.Host}:${address.port}${basePath}`;
}

