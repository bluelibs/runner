import { events, r, resources } from "@bluelibs/runner";
import { ITask } from "@bluelibs/runner/defs";
import { Request, Response, type Express } from "express";
import { httpTag } from "../tags/http.tag";
import { RequestContext, RequestData } from "../contexts/request.context";
import { expressServerResource } from "../resources/express.resource";
import type { HttpRouteConfig } from "../types";
import { resolveHttpError } from "../utils/http-error";
import {
  buildOpenApiOperation,
  buildOpenApiSpec,
  toOpenApiPath,
} from "../utils/openapi";
import swaggerUi from "swagger-ui-express";

type HttpTask = ITask<any, any, any, any, any, any>;
type RouteHandler = (req: Request, res: Response) => Promise<void>;
type RouteRegistrar = (path: string, handler: RouteHandler) => void;

function createRouteRegistrars(app: Express) {
  return {
    GET: app.get.bind(app),
    POST: app.post.bind(app),
    PUT: app.put.bind(app),
    DELETE: app.delete.bind(app),
    PATCH: app.patch.bind(app),
  } satisfies Record<HttpRouteConfig["method"], RouteRegistrar>;
}

export const routeRegistrationHook = r
  .hook("routeRegistration")
  .on(events.ready)
  .dependencies({
    httpTag: httpTag.startup(),
    taskRunner: resources.taskRunner,
    expressServer: expressServerResource,
    logger: resources.logger,
  })
  .run(async (_, { httpTag, taskRunner, expressServer, logger }) => {
    const { app, port } = expressServer;
    const paths: Record<string, Record<string, unknown>> = {};
    const routeRegistrars = createRouteRegistrars(app);

    let routesRegistered = 0;

    const createRouteHandler =
      (task: HttpTask) =>
      async (req: Request, res: Response) => {
        try {
          const requestData: RequestData = (
            req as unknown as { requestData: RequestData }
          ).requestData;
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
          const { statusCode, message } = resolveHttpError(err);
          const error = err instanceof Error ? err : new Error(String(err));

          if (statusCode >= 500) {
            logger.error("Route handler error:", { error });
          } else {
            logger.warn("Route handler rejected request", { error });
          }

          res.status(statusCode).json({
            success: false,
            error: message,
          });
        }
      };

    httpTag.tasks.forEach((entry) => {
      const task = entry.definition as HttpTask;
      const config = entry.config;
      const method = config?.method;
      const path = config?.path;
      if (!config || !method || !path) return;

      routeRegistrars[method](path, createRouteHandler(task));
      logger.info(`📍 ${method} ${path} -> ${String(task.id)}`);
      routesRegistered++;

      const openApiPath = toOpenApiPath(path);

      if (!paths[openApiPath]) paths[openApiPath] = {};
      paths[openApiPath][method.toLowerCase()] = buildOpenApiOperation(config);
    });

    const openApiSpec = buildOpenApiSpec(paths, port);

    logger.info(`🔗 Registered a total of ${routesRegistered} routes`);

    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
    logger.info(`🔗 Swagger UI available at http://localhost:${port}/api-docs`);

    return { routesRegistered };
  })
  .build();
