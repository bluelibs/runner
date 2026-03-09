import { events, Match, r, resources } from "@bluelibs/runner";
import { ITask, ValidationSchemaInput } from "@bluelibs/runner/defs";
import { Request, Response } from "express";
import { httpTag } from "../tags/http.tag";
import { RequestContext, RequestData } from "../contexts/request.context";
import { expressServerResource } from "../resources/express.resource";
import swaggerUi from "swagger-ui-express";

function stripSchemaMarkers(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripSchemaMarkers);

  const copy: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema") continue;
    copy[key] = stripSchemaMarkers(child);
  }

  return copy;
}

function toOpenApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function toJsonSchema(
  schema?: ValidationSchemaInput,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  if (
    typeof schema === "object" &&
    schema !== null &&
    "toJSONSchema" in schema &&
    typeof schema.toJSONSchema === "function"
  ) {
    return stripSchemaMarkers(schema.toJSONSchema()) as Record<string, unknown>;
  }

  return stripSchemaMarkers(Match.toJSONSchema(schema as never)) as Record<
    string,
    unknown
  >;
}

function schemaToParameters(
  schema: Record<string, unknown> | undefined,
  location: "path" | "query",
) {
  if (!schema) return [];

  const properties = schema.properties;
  const requiredList = Array.isArray(schema.required) ? schema.required : [];
  const requiredSet = new Set(
    requiredList.filter((value): value is string => typeof value === "string"),
  );

  if (!properties || typeof properties !== "object") {
    return [];
  }

  return Object.entries(properties).map(([name, parameterSchema]) => ({
    in: location,
    name,
    required: location === "path" ? true : requiredSet.has(name),
    schema: parameterSchema,
  }));
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

    let routesRegistered = 0;

    const createRouteHandler =
      (task: ITask<any, any, any, any, any, any>) =>
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
          logger.error("Route handler error:", { error: err as Error });
          res.status(200).json({
            success: false,
            error: err instanceof Error ? err.message : "Internal server error",
          });
        }
      };

    httpTag.tasks.forEach((entry) => {
      const task = entry.definition;
      const config = entry.config;
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
      (app as unknown as Record<string, Function>)[method.toLowerCase()](
        path,
        createRouteHandler(
          task as unknown as ITask<any, any, any, any, any, any>,
        ),
      );
      logger.info(`📍 ${method} ${path} -> ${String(task.id)}`);
      routesRegistered++;

      const paramsJsonSchema = toJsonSchema(paramsSchema);
      const queryJsonSchema = toJsonSchema(querySchema);
      const requestBodyJsonSchema = toJsonSchema(requestBodySchema);
      const responseJsonSchema = toJsonSchema(responseSchema);
      const openApiPath = toOpenApiPath(path);
      const parameters = [
        ...schemaToParameters(paramsJsonSchema, "path"),
        ...schemaToParameters(queryJsonSchema, "query"),
      ];

      if (!paths[openApiPath]) paths[openApiPath] = {};

      const operation: Record<string, unknown> = {
        summary,
        description,
        tags,
        responses: {
          "200": {
            description: "OK",
            content: responseJsonSchema
              ? { "application/json": { schema: responseJsonSchema } }
              : undefined,
          },
        },
      };

      if (requiresAuth) {
        operation.security = [{ BearerAuth: [] }];
      }

      if (parameters.length > 0) {
        operation.parameters = parameters;
      }

      if (requestBodyJsonSchema && method.toLowerCase() !== "get") {
        operation.requestBody = {
          content: { "application/json": { schema: requestBodyJsonSchema } },
        };
      }

      paths[openApiPath][method.toLowerCase()] = operation;
    });

    const openApiSpec = {
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
    };

    logger.info(`🔗 Registered a total of ${routesRegistered} routes`);

    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
    logger.info(`🔗 Swagger UI available at http://localhost:${port}/api-docs`);

    return { routesRegistered };
  })
  .build();
