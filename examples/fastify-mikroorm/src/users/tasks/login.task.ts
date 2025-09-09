import { task } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "../../http/tags";
import { db } from "../../db/resources";
import { auth as authResource } from "../resources/auth.resource";
import { fastifyContext } from "../../http/fastify-context";
import { HTTPError } from "../../http/http-error";

export const loginUser = task({
  id: "app.users.tasks.login",
  meta: {
    title: "User Login",
    description:
      "Authenticate user with email and password, returning JWT token and user details",
  },
  inputSchema: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  resultSchema: z
    .object({
      token: z.string(),
      user: z
        .object({ id: z.string(), name: z.string(), email: z.string() })
        .strict(),
    })
    .strict(),
  tags: [httpRoute.with({ method: "post", path: "/auth/login", auth: "public" })],
  dependencies: { db, auth: authResource },
  run: async (input, { db, auth }) => {
    const email = String(input.email || "")
      .toLowerCase()
      .trim();
    const password = String(input.password || "");

    if (!email || !password) throw new HTTPError(400, "email and password are required");

    const em = db.em();
    const User = db.entities.User;
    const user = await em.findOne(User, { email });
    if (!user || !user.passwordHash || !user.passwordSalt) throw new HTTPError(401, "Invalid email or password");

    const valid = await auth.verifyPassword(
      password,
      user.passwordHash,
      user.passwordSalt,
    );
    if (!valid) throw new HTTPError(401, "Invalid email or password");

    const token = auth.createSessionToken(user.id);
    const payload = auth.verifyToken(token)!;
    const maxAge = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
    const { reply } = fastifyContext.use();
    reply.header("Set-Cookie", auth.buildAuthCookie(token, maxAge));

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  },
});
