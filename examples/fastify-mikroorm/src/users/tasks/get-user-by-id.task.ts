import { r } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "#/web/tags";
import { db } from "#/db/resources";
import { HTTPError } from "#/web/http-error";

export const getUserById = r
  .task("getUserById")
  .meta({
    title: "Get User By ID",
    description: "Retrieve a single user by its unique identifier",
  })
  // We expect the id to come from path params
  .inputSchema(z.object({ id: z.string() }).strict())
  .resultSchema(
    z.object({ id: z.string(), name: z.string(), email: z.string() }).strict(),
  )
  .tags([
    httpRoute.with({
      method: "get",
      path: "/user/:id",
      inputFrom: "merged", // include params so task gets the id
      auth: "required",
    }),
  ])
  .dependencies({ db })
  .run(async (input, { db }) => {
    const em = db.em();
    const user = await em.findOne(db.entities.User, { id: input.id });
    if (!user) throw new HTTPError(404, "User not found");
    return { id: user.id, name: user.name, email: user.email };
  })
  .build();
