import { r, globals } from "@bluelibs/runner";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import { httpTag } from "../tags/http.tag";
import { RequestData } from "../contexts/request.context";
import { appConfig } from "../../app.config";
// Simple UUID generator (for demo purposes)
const generateId = () =>
  Math.random().toString(36).substring(2) + Date.now().toString(36);

export interface ExpressServer {
  app: Express;
  server: any | null;
  port: number;
}

export const expressServerResource = r
  .resource("app.resources.expressServer")
  .dependencies({
    appConfig,
    logger: globals.resources.logger,
  })
  .register([httpTag])
  .init(async (_, { appConfig, logger }): Promise<ExpressServer> => {
    const { port, host, listen } = appConfig;

    const app = express();

    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cors());

    // Request context middleware
    app.use((req: Request, res: Response, next) => {
      const requestData: RequestData = {
        requestId: generateId(),
        ip: req.ip || req.socket.remoteAddress || "unknown",
        userAgent: req.get("User-Agent") || "unknown",
        timestamp: new Date(),
      };

      // Store request data for use in tasks
      (req as unknown as { requestData: RequestData }).requestData = requestData;
      next();
    });

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    if (!listen) {
      logger.debug("Express server listen disabled");
      return { app, server: null, port };
    }

    // Start server, we do this to ensure before this resource responds, the server is ready.
    const promise = new Promise<ExpressServer>((resolve, reject) => {
      const server = app.listen(port, host, () => {
        logger.info(`🚀 Express server running on http://${host}:${port}`);
        logger.info(`📚 API documentation: http://${host}:${port}/api-docs`);
        resolve({ app, server, port });
      });
      server.on("error", (err: Error) => {
        reject(err);
      });
    });

    return promise;
  })
  .dispose(async ({ server }, _, { logger }) => {
    if (!server) return;
    return new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("Express server stopped");
        resolve();
      });
    });
  })
  .build();
