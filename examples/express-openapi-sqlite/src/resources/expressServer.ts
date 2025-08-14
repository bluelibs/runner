import { resource, task, globals } from "@bluelibs/runner";
import express, { Express, Request, Response } from "express";
import cors from "cors";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { httpTag } from "../tags/httpTag";
import { RequestContext, RequestData } from "../contexts";
// Simple UUID generator (for demo purposes)
const generateId = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

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

export const expressServerResource = resource<ExpressConfig, Promise<ExpressServer>>({
  id: "app.resources.expressServer",
  init: async (config: ExpressConfig): Promise<ExpressServer> => {
    const { port, cors: enableCors = true, apiPrefix = '/api' } = config;
    
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
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent'),
        timestamp: new Date()
      };
      
      // Store request data for use in tasks
      (req as any).requestData = requestData;
      next();
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
        console.log('Express server stopped');
        resolve();
      });
    });
  }
});

/**
 * Route registration task that listens to afterInit event
 * and automatically registers HTTP routes based on task tags
 */
export const routeRegistrationTask = task({
  id: "app.tasks.routeRegistration",
  dependencies: { expressServer: expressServerResource },
  on: globals.events.afterInit,
  run: async (_, { expressServer }: { expressServer: ExpressServer }) => {
    const { app } = expressServer;
    
    // This task will be called after all resources are initialized
    // We need to scan for tasks with HTTP tags and register routes
    console.log('🔧 Setting up route registration...');
    
    // Note: In a real implementation, we would need access to the store
    // to scan all registered tasks. For now, we'll set up the infrastructure
    // and let individual tasks register themselves.
    
    // Setup Swagger documentation
    const swaggerOptions: swaggerJSDoc.Options = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'BlueLibs Runner Express API',
          version: '1.0.0',
          description: 'A complete Express app with authentication using BlueLibs Runner'
        },
        servers: [
          {
            url: `http://localhost:${expressServer.port}`,
            description: 'Development server'
          }
        ],
        components: {
          securitySchemes: {
            BearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            }
          }
        }
      },
      apis: [] // We'll add this programmatically
    };

    const swaggerSpec = swaggerJSDoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    
    console.log('✅ Route registration setup complete');
  }
});