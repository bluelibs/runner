import * as http from "http";

import {
  jsonErrorResponse,
  NOT_FOUND_RESPONSE,
  respondJson,
} from "./httpResponse";
import { errorMessage, safeLogError } from "./logging";
import type { RequestHandler } from "./types";
import type { Logger } from "../../models/Logger";

export function makeRequestListener(options: {
  handler: RequestHandler;
  respondOnMiss: boolean;
  logger: Logger;
}): http.RequestListener {
  const { handler, respondOnMiss, logger } = options;
  return (req, res) => {
    handler(req, res)
      .then((handled) => {
        if (!handled && respondOnMiss && !res.writableEnded) {
          respondJson(res, NOT_FOUND_RESPONSE);
        }
      })
      .catch((error) => {
        safeLogError(logger, "exposure.http.unhandled", {
          error: errorMessage(error),
        });
        if (!res.writableEnded) {
          respondJson(
            res,
            jsonErrorResponse(500, "Internal Error", "INTERNAL_ERROR"),
          );
        }
      });
  };
}

export async function startHttpServer(
  server: http.Server,
  listen: { port: number; host?: string },
): Promise<void> {
  const host = listen.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    const hasEmitterApi =
      typeof server.once === "function" &&
      typeof server.removeListener === "function";
    if (!hasEmitterApi) {
      try {
        server.listen(listen.port, host, resolve);
      } catch (error) {
        reject(error);
      }
      return;
    }

    const onError = (error: Error) => {
      server.removeListener("error", onError);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    try {
      server.listen(listen.port, host, onListening);
    } catch (error) {
      server.removeListener("error", onError);
      reject(error);
    }
  });
}

export async function stopHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
