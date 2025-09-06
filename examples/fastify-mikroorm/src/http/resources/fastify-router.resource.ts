import { globals, resource } from "@bluelibs/runner";
import { httpRoute } from "../tags";
import { fastify } from "./fastify.resource";
import { fastifyContext } from "../fastify-context";

export const fastifyRouter = resource({
  id: "app.http.resources.fastify-router",
  meta: {
    title: "Fastify HTTP Router",
    description: "Automatically registers HTTP routes from tasks tagged with httpRoute configuration",
  },
  // tags: [],
  dependencies: {
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    fastify,
  },
  init: async (_config, { store, taskRunner, fastify }) => {
    // We scan for all the tasks that have a route and register them

    store.getTasksWithTag(httpRoute).forEach((task) => {
      // We get the tag config and define the routing
      const config = httpRoute.extract(task)!;
      fastify[config.method](config.path, async (request, reply) => {
        await fastifyContext.provide({ request, reply }, async () => {
          const result = await taskRunner.run(task, request.body as any);
          // We give the freedom to the task to send the reply itself
          if (!reply.sent) {
            reply.send(result);
          }
        });
      });
    });
    return {};
  },
});
