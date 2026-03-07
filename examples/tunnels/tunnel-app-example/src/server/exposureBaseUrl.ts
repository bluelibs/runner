import type { RpcLanesResourceValue } from "@bluelibs/runner/node";

import { HttpConfig, Protocol } from "../ids.js";

enum ErrorMessage {
  MissingExposure = "RPC lane exposure is not available",
  MissingServer = "RPC lane exposure server is not available",
  MissingAddress = "RPC lane exposure server address is missing",
  PipeNotSupported = "Pipe addresses are not supported by this example",
}

export function getExposureBaseUrl(value: RpcLanesResourceValue): string {
  const handlers = value.exposure?.getHandlers?.();
  if (!handlers) {
    throw new Error(ErrorMessage.MissingExposure);
  }

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
