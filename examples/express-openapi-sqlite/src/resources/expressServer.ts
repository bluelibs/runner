import { resource, task, globals } from "@bluelibs/runner";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { httpTag } from "../tags/httpTag";
import { RequestContext, RequestData } from "../contexts";
// Simple UUID generator (for demo purposes)
const generateId = () =>
  Math.random().toString(36).substring(2) + Date.now().toString(36);

export interface ExpressConfig {
  port: number;
  cors?: boolean;
  apiPrefix?: string;
  swaggerOptions?: swaggerJSDoc.Options;
}

export interface ExpressServer {
  app: Express;
  server: any;
  port: number;
}

export const expressServerResource = resource<
  ExpressConfig,
  Promise<ExpressServer>
>({
  id: "app.resources.expressServer",
  init: async (config: ExpressConfig): Promise<ExpressServer> => {
    const { port, cors: enableCors = true, apiPrefix = "/api" } = config;

    const app = express();

    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    if (enableCors) {
      app.use(cors());
    }

    // Request context middleware
    app.use((req: Request, res: Response, next) => {
      const requestData: RequestData = {
        requestId: generateId(),
        ip: req.ip || req.connection.remoteAddress || "unknown",
        userAgent: req.get("User-Agent"),
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

    // Start server
    const server = app.listen(port, () => {
      console.log(`🚀 Express server running on http://localhost:${port}`);
      console.log(`📚 API documentation: http://localhost:${port}/api-docs`);
    });

    return { app, server, port };
  },
  dispose: async ({ server }: ExpressServer) => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        console.log("Express server stopped");
        resolve();
      });
    });
  },
});
