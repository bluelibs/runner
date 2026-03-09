import { Match, r } from "@bluelibs/runner";
import { httpRoute } from "#/web/tags";

export const healthz = r
  .task("healthz")
  .meta({
    title: "Health Check",
    description: "Liveness probe endpoint",
  })
  .resultSchema(Match.compile({ status: Match.OneOf("ok") }))
  .tags([httpRoute.with({ method: "get", path: "/healthz" })])
  .run(async () => ({ status: "ok" as const }))
  .build();
