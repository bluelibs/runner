import { task } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "../../http/tags";
import { auth as authResource } from "../resources/auth.resource";
import { fastifyContext } from "../../http/fastify-context";
import { HTTPError } from "../../http/http-error";

export const logoutUser = task({
  id: "app.users.tasks.logout",
  meta: {
    title: "User Logout",
    description: "Clear user authentication cookie and end session",
  },
  resultSchema: z.object({ success: z.literal(true) }),
  tags: [httpRoute.with({ method: "post", path: "/auth/logout", auth: "optional" })],
  dependencies: { auth: authResource },
  run: async (_input, { auth }) => {
    const { reply } = fastifyContext.use();
    reply.header("Set-Cookie", auth.clearAuthCookie());
    return { success: true };
  },
});
