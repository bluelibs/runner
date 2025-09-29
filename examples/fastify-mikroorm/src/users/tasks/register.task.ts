import { r } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "#/http/tags";
import { db } from "#/db/resources";
import { auth as authResource } from "#/users/resources/auth.resource";
import { randomUUID } from "crypto";
import { fastifyContext } from "#/http/fastify-context";
import { HTTPError } from "#/http/http-error";

export const registerUser = r
  .task("app.users.tasks.register")
  .meta({
    title: "User Registration",
    description: "Register new user with name, email and password, returning JWT token and user details",
  })
  .inputSchema(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
  }))
  .resultSchema(z
    .object({
      token: z.string(),
      user: z
        .object({ id: z.string(), name: z.string(), email: z.string() })
        .strict(),
    })
    .strict())
  .tags([httpRoute.with({ method: "post", path: "/auth/register", auth: "public" })])
  .dependencies({ db, auth: authResource })
  .run(async (input, { db, auth }) => {
    const { reply } = fastifyContext.use();
    const name = String(input.name || "").trim();
    const email = String(input.email || "").toLowerCase().trim();
    const password = String(input.password || "");

    const em = db.em();
    const User = db.entities.User;
    const existing = await em.findOne(User, { email });
    if (existing) throw new HTTPError(409, "Email already registered");

    const { hash, salt } = await auth.hashPassword(password);
    const user = em.create(User, {
      id: randomUUID(),
      name,
      email,
      passwordHash: hash,
      passwordSalt: salt,
    });
    em.persist(user);
    await em.flush();

    const token = auth.createSessionToken(user.id);
    const payload = auth.verifyToken(token)!;
    const maxAge = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
    reply.header("Set-Cookie", auth.buildAuthCookie(token, maxAge));

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  })
  .build();
