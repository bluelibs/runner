import * as http from "http";

import { safeLogInfo } from "./logging";
import {
  makeRequestListener,
  startHttpServer,
  stopHttpServer,
} from "./serverLifecycle";
import type { RequestHandler } from "./types";
import type { NodeExposureDeps, NodeExposureHttpConfig } from "./resourceTypes";

interface ExposureServerOptions {
  httpConfig?: NodeExposureHttpConfig;
  handler: RequestHandler;
  logger: NodeExposureDeps["logger"];
  basePath: string;
}

interface ExposureServerControls {
  server: http.Server | null;
  createRequestListener(): http.RequestListener;
  createServer(): http.Server;
  attachTo(server: http.Server): () => void;
  close(): Promise<void>;
}

export async function createExposureServer(
  options: ExposureServerOptions,
): Promise<ExposureServerControls> {
  const { httpConfig, handler, logger, basePath } = options;

  const attachments: Array<() => void> = [];

  const registerDetach = (detach: () => void) => {
    let active = true;
    const wrapped = () => {
      if (!active) {
        return;
      }
      active = false;
      detach();
      const index = attachments.indexOf(wrapped);
      if (index >= 0) {
        attachments.splice(index, 1);
      }
    };
    attachments.push(wrapped);
    return wrapped;
  };

  const makeListener = (respondOnMiss: boolean) =>
    makeRequestListener({
      handler,
      respondOnMiss,
      logger,
      cors: httpConfig?.cors,
    });

  const attachExposure = (targetServer: http.Server) => {
    const listener = makeListener(false);
    targetServer.on("request", listener);
    return registerDetach(() => {
      targetServer.off("request", listener);
    });
  };

  const createServerInstance = () => http.createServer(makeListener(true));

  let server: http.Server | null = null;
  let ownsServer = false;

  if (httpConfig?.server) {
    server = httpConfig.server;
    attachExposure(server);
  }

  if (!httpConfig?.server && httpConfig?.listen) {
    server = createServerInstance();
    ownsServer = true;
    const listenHost = httpConfig.listen.host ?? "127.0.0.1";
    await startHttpServer(server, {
      port: httpConfig.listen.port,
      host: listenHost,
    });
    safeLogInfo(logger, "node.exposure.listen", {
      basePath,
      port: httpConfig.listen.port,
      host: listenHost,
    });
  }

  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const close = async () => {
    if (closed) return;
    if (closing) {
      // Another caller is already closing; await completion
      // `closing` is only set immediately before `closePromise` assignment in the same tick.
      await closePromise!;
      return;
    }
    closing = true;
    closePromise = (async () => {
      try {
        while (attachments.length > 0) {
          const detach = attachments.pop();
          if (detach) {
            try {
              detach();
            } catch {
              // best-effort detach; ignore
            }
          }
        }
        if (ownsServer && server) {
          await stopHttpServer(server);
        }
      } finally {
        closed = true;
      }
    })();
    await closePromise;
  };

  return {
    server,
    createRequestListener: () => makeListener(true),
    createServer: () => http.createServer(makeListener(true)),
    attachTo: (targetServer: http.Server) => attachExposure(targetServer),
    close,
  };
}
