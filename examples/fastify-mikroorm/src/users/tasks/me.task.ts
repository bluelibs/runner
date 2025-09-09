import { task } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "#/http/tags";
import { db } from "#/db/resources";
import { auth as authResource } from "#/users/resources/auth.resource";
import { fastifyContext } from "#/http/fastify-context";
import { HTTPError } from "#/http/http-error";

export const currentUser = task({
  id: "app.users.tasks.me",
  meta: {
    title: "Get Current User",
    description:
      "Retrieve current authenticated user's profile information from JWT token",
  },
  inputSchema: z.undefined(),
  resultSchema: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .strict(),
  tags: [httpRoute.with({ method: "get", path: "/me", auth: "required" })],
  dependencies: { db, auth: authResource },
  run: async (_input, { db, auth }) => {
    const { user: current } = fastifyContext.use();
    if (!current) throw new HTTPError(401, "Unauthorized");

    const em = db.em();
    const user = await em.findOne(db.entities.User, { id: current.id });
    if (!user) throw new HTTPError(401, "Unauthorized");

    return { id: user.id, name: user.name, email: user.email };
  },
});
