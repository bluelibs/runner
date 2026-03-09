import { events, r, resources } from "@bluelibs/runner";
import { fastify } from "#/web/resources/fastify.resource";
import { env } from "#/general/resources/env.resource";

// We start the server once all the hooks and resources have been registered.
export const onReady = r
  .hook("onReady")
  .meta({
    title: "HTTP Server Ready Hook",
    description:
      "Starts the Fastify server on port 3000 when the application is ready",
  })
  .on(events.ready)
  .dependencies({
    fastify: fastify,
    logger: resources.logger,
    env,
  })
  .run(async (_, { fastify, logger, env }) => {
    const port = Number(env.PORT || 3000);
    await fastify.listen({ port });
    logger.info(`Fastify is listening on port ${port}`);
    logger.info(`Swagger UI available at http://localhost:${port}/swagger`);
  })
  .build();
