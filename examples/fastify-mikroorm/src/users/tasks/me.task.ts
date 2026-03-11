import { Match, r } from "@bluelibs/runner";
import { httpRoute } from "#/web/tags";
import { db } from "#/db/resources";
import { auth as authResource } from "#/users/resources/auth.resource";
import { fastifyContext } from "#/web/fastify-context";
import { HTTPError } from "#/web/http-error";

export const currentUser = r
  .task("me")
  .meta({
    title: "Get Current User",
    description:
      "Retrieve current authenticated user's profile information from JWT token",
  })
  .resultSchema(
    Match.compile({
      id: Match.NonEmptyString,
      name: Match.NonEmptyString,
      email: Match.Email,
    }),
  )
  .tags([httpRoute.with({ method: "get", path: "/me", auth: "required" })])
  .dependencies({ db, auth: authResource })
  .run(async (_input, { db, auth }) => {
    const { user: current } = fastifyContext.use();
    if (!current) throw new HTTPError(401, "Unauthorized");

    const em = db.em();
    const user = await em.findOne(db.entities.User, { id: current.id });
    if (!user) throw new HTTPError(401, "Unauthorized");

    return { id: user.id, name: user.name, email: user.email };
  })
  .build();
