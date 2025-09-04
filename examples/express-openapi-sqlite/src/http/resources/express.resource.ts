import { resource, task, globals } from "@bluelibs/runner";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { httpTag } from "../tags/http.tag";
import { RequestContext, RequestData } from "../request.context";
import { appConfig } from "../../app.config";
// Simple UUID generator (for demo purposes)
const generateId = () =>
  Math.random().toString(36).substring(2) + Date.now().toString(36);

export interface ExpressServer {
  app: Express;
  server: any;
  port: number;
}

export const expressServerResource = resource({
  id: "app.resources.expressServer",
  dependencies: {
    appConfig,
    logger: globals.resources.logger,
  },
  register: [httpTag],
  init: async (_, { appConfig, logger }): Promise<ExpressServer> => {
    const { port } = appConfig;

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
      (req as any).requestData = requestData;
      next();
    });

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Start server, we do this to ensure before this resource responds, the server is ready.
    const promise = new Promise<ExpressServer>((resolve, reject) => {
      const server = app.listen(port, () => {
        logger.info(`🚀 Express server running on http://localhost:${port}`);
        logger.info(`📚 API documentation: http://localhost:${port}/api-docs`);
        resolve({ app, server, port });
      });
      server.on("error", (err: Error) => {
        reject(err);
      });
    });

    return promise;
  },
  dispose: async ({ server }, _, { logger }) => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("Express server stopped");
        resolve();
      });
    });
  },
});
