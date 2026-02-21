import { r, globals } from "@bluelibs/runner";
import { httpRoute } from "#/http/tags";
import { fastify } from "./fastify.resource";
import { fastifyContext } from "#/http/fastify-context";
import { randomUUID } from "crypto";
import { auth as authResource } from "#/users/resources/auth.resource";
import { db } from "#/db/resources";
import { extractToken } from "#/users/http-auth";
import type { AuthenticatedUser } from "#/http/fastify-context";
import { buildRouteSchema } from "./helpers/buildRouteSchema";
import { extractAuthUser } from "./helpers/extractAuthUser";
import { buildTaskInput } from "./helpers/buildTaskInput";
import { createHttpChildLogger } from "./helpers/createHttpChildLogger";
import { runTaskWithHttpContext } from "./helpers/runTaskWithHttpContext";
import type { TaskWithSchemas } from "./helpers/types";

export const fastifyRouter = r
  .resource("app.http.resources.fastify-router")
  .meta({
    title: "Fastify HTTP Router",
    description:
      "Automatically registers HTTP routes from tasks tagged with httpRoute configuration",
  })
  .dependencies({
    httpRoute: httpRoute.beforeInit(),
    taskRunner: globals.resources.taskRunner,
    fastify,
    logger: globals.resources.logger,
    auth: authResource,
    db,
  })
  .init(async (_config, { httpRoute, taskRunner, fastify, logger, auth, db }) => {
    httpRoute.tasks.forEach(({ definition: task, config }) => {
      if (!config) {
        return;
      }
      const schema = buildRouteSchema(task as TaskWithSchemas, config);

      fastify.route({
        method: config.method.toUpperCase(),
        url: config.path,
        schema,
        handler: async (request: any, reply: any) => {
          const requestId = request.headers["x-request-id"] || randomUUID();
          reply.header("x-request-id", requestId);

          const childLogger = createHttpChildLogger(logger, {
            requestId: String(requestId),
            method: config.method.toUpperCase(),
            path: config.path,
          });

          const user = await extractAuthUser({
            request,
            auth,
            db,
            extractToken,
          });
          const authMode = config.auth || "public";
          if (authMode === "required" && !user) {
            reply.code(401).send({ error: "Unauthorized" });
            return;
          }

          const input = buildTaskInput(request, config.inputFrom);

          const result = await runTaskWithHttpContext({
            taskRunner,
            task,
            input,
            fastifyContext,
            contextValues: {
              request,
              reply,
              requestId: String(requestId),
              user: user as AuthenticatedUser | null,
              userId: user?.id ?? null,
              logger: childLogger,
            },
            onSuccess: ({ tookMs, statusCode }) => {
              childLogger.info("request.ok", { statusCode, tookMs });
            },
            onError: ({ tookMs }, err) => {
              childLogger.error("request.err", {
                message: err?.message,
                tookMs,
              });
            },
          });
          if (!reply.sent) {
            reply.send(result);
          }
        },
      });
    });
    return {};
  })
  .build();
