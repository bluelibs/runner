import { Match, r } from "@bluelibs/runner";
import { httpRoute } from "#/web/tags";
import { db } from "#/db/resources";
import { auth as authResource } from "#/users/resources/auth.resource";
import { fastifyContext } from "#/web/fastify-context";
import { HTTPError } from "#/web/http-error";

export const loginUser = r
  .task("login")
  .meta({
    title: "User Login",
    description:
      "Authenticate user with email and password, returning JWT token and user details",
  })
  .inputSchema(
    Match.compile({
      email: Match.Email,
      password: Match.NonEmptyString,
    }),
  )
  .resultSchema(
    Match.compile({
      token: Match.NonEmptyString,
      user: {
        id: Match.NonEmptyString,
        name: Match.NonEmptyString,
        email: Match.Email,
      },
    }),
  )
  .tags([
    httpRoute.with({ method: "post", path: "/auth/login", auth: "public" }),
  ])
  .dependencies({ db, auth: authResource })
  .run(async (input, { db, auth }) => {
    const email = String(input.email || "")
      .toLowerCase()
      .trim();
    const password = String(input.password || "");

    if (!email || !password)
      throw new HTTPError(400, "email and password are required");

    const em = db.em();
    const User = db.entities.User;
    const user = await em.findOne(User, { email });
    if (!user || !user.passwordHash || !user.passwordSalt)
      throw new HTTPError(401, "Invalid email or password");

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
  })
  .build();
