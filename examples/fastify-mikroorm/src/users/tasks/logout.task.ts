import { Match, r } from "@bluelibs/runner";
import { httpRoute } from "#/web/tags";
import { auth as authResource } from "#/users/resources/auth.resource";
import { fastifyContext } from "#/web/fastify-context";

export const logoutUser = r
  .task("logout")
  .meta({
    title: "User Logout",
    description: "Clear user authentication cookie and end session",
  })
  .resultSchema(Match.compile({ success: Match.OneOf(true) }))
  .tags([
    httpRoute.with({ method: "post", path: "/auth/logout", auth: "optional" }),
  ])
  .dependencies({ auth: authResource })
  .run(async (_input, { auth }) => {
    const { reply } = fastifyContext.use();
    reply.header("Set-Cookie", auth.clearAuthCookie());
    return { success: true };
  })
  .build();
