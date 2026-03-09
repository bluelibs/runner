import { Match, r } from "@bluelibs/runner";
import { httpRoute } from "#/web/tags";
import { db } from "#/db/resources";

export const readyz = r
  .task("readyz")
  .meta({
    title: "Readiness Check",
    description: "Readiness probe endpoint (checks DB)",
  })
  .resultSchema(Match.compile({ status: Match.OneOf("ok") }))
  .tags([httpRoute.with({ method: "get", path: "/readyz" })])
  .dependencies({ db })
  .run(async (_input, { db }) => {
    const em = db.em();
    // Simple connectivity check: run a trivial query through the ORM
    await em.getConnection().execute("select 1");
    return { status: "ok" as const };
  })
  .build();
