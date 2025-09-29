// examples/express-openapi-sqlite/src/tasks/routeRegistration.ts
import { r, globals } from "@bluelibs/runner";
import { Request, Response } from "express";
import { httpTag } from "../tags/http.tag";
import { RequestContext, RequestData } from "../contexts/request.context";
import { expressServerResource } from "../resources/express.resource";
import swaggerUi from "swagger-ui-express";
import { createDocument } from "zod-openapi";

export const routeRegistrationHook = r
  .hook("app.hooks.routeRegistration")
  .on(globals.events.ready)
  .dependencies({
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    expressServer: expressServerResource,
    logger: globals.resources.logger,
  })
  .run(async (_, { store, taskRunner, expressServer, logger }) => {
    const { app, port } = expressServer;
    const paths: Record<string, any> = {};

    // Existing: register handlers
    const allTasks = Array.from(store.tasks.values());
    let routesRegistered = 0;

    const createRouteHandler =
      (task: any) => async (req: Request, res: Response) => {
        try {
          const requestData: RequestData = (req as any).requestData;
          const taskInput = {
            ...req.body,
            ...req.params,
            ...req.query,
            request: req,
            response: res,
          };
          const result = await RequestContext.provide(requestData, () =>
            taskRunner.run(task, taskInput),
          );
          res.status(200).json(result);
        } catch (err) {
          logger.error("Route handler error:", { error: err as Error });
          res.status(200).json({
            success: false,
            error: err instanceof Error ? err.message : "Internal server error",
          });
        }
      };

    allTasks.forEach((taskElement) => {
      const task = taskElement.task;
      const config = httpTag.extract(task);
      if (!config) return;

      const {
        method,
        path,
        summary,
        description,
        tags,
        requiresAuth,
        paramsSchema,
        querySchema,
        requestBodySchema,
        responseSchema,
      } = config;

      if (!method || !path) return;

      // Register runtime express handler
      (app as any)[method.toLowerCase()](path, createRouteHandler(task));
      logger.info(`📍 ${method} ${path} -> ${String(task.id)}`);
      routesRegistered++;

      // Build zod-openapi path item
      if (!paths[path]) paths[path] = {};
      const operation: any = {
        summary,
        description,
        tags,
        responses: {
          "200": {
            description: "OK",
            content: responseSchema
              ? { "application/json": { schema: responseSchema } }
              : undefined,
          },
        },
      };
      if (requiresAuth) {
        operation.security = [{ BearerAuth: [] }];
      }
      const requestParams: any = {};
      if (paramsSchema) requestParams.path = paramsSchema;
      if (querySchema) requestParams.query = querySchema;
      if (Object.keys(requestParams).length > 0) {
        operation.requestParams = requestParams;
      }
      if (requestBodySchema && method.toLowerCase() !== "get") {
        operation.requestBody = {
          content: { "application/json": { schema: requestBodySchema } },
        };
      }
      paths[path][method.toLowerCase()] = operation;
    });

    // Build and serve spec (OpenAPI 3.1 via zod-openapi)
    const openApiSpec = createDocument({
      openapi: "3.1.0",
      info: {
        title: "BlueLibs Runner Express API",
        version: "1.0.0",
        description:
          "A complete Express app with authentication using BlueLibs Runner",
      },
      servers: [
        { url: `http://localhost:${port}`, description: "Development server" },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT Authentication",
          },
        },
      },
      paths,
    });

    logger.info(`🔗 Registered a total of ${routesRegistered} routes`);

    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
    logger.info(`🔗 Swagger UI available at http://localhost:${port}/api-docs`);

    return { routesRegistered };
  })
  .build();
