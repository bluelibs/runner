import { r } from "@bluelibs/runner";
import { fastifyRouter } from "./resources/fastify-router.resource";
import { fastify } from "./resources/fastify.resource";
import { httpRoute } from "./tags";
import { onReady } from "./hooks/onReady.hook";
import { healthz } from "./tasks/healthz.task";
import { readyz } from "./tasks/readyz.task";

export * from "./resources/fastify.resource";

export const http = r
  .resource("app.http.resources.http")
  .meta({
    title: "HTTP Module",
    description: "HTTP server module with Fastify integration and automatic route registration",
  })
  .register([fastify, fastifyRouter, httpRoute, onReady, healthz, readyz])
  .build();
