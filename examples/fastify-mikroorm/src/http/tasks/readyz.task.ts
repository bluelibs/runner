import { task } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "../tags";
import { db } from "../../db/resources";

export const readyz = task({
  id: "app.http.tasks.readyz",
  meta: {
    title: "Readiness Check",
    description: "Readiness probe endpoint (checks DB)",
  },
  inputSchema: z.undefined(),
  resultSchema: z.object({ status: z.literal("ok") }),
  tags: [httpRoute.with({ method: "get", path: "/readyz" })],
  dependencies: { db },
  run: async (_input, { db }) => {
    const em = db.em();
    // Simple connectivity check: run a trivial query through the ORM
    await em.getConnection().execute("select 1");
    return { status: "ok" as const };
  },
});

