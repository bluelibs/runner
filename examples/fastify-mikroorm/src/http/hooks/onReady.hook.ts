import { globals, hook } from "@bluelibs/runner";
import { fastify } from "#/http/resources/fastify.resource";
import { env } from "#/general/resources/env.resource";

// We start the server once all the hooks and resources have been registered.
export const onReady = hook({
  id: "app.http.hooks.onReady",
  meta: {
    title: "HTTP Server Ready Hook",
    description:
      "Starts the Fastify server on port 3000 when the application is ready",
  },
  on: globals.events.ready,
  dependencies: {
    fastify: fastify,
    logger: globals.resources.logger,
    env,
  },
  async run(_, { fastify, logger, env }) {
    const port = Number(env.PORT || 3000);
    await fastify.listen({ port });
    logger.info(`Fastify is listening on port ${port}`);
    logger.info(`Swagger UI available at http://localhost:${port}/swagger`);
  },
});
