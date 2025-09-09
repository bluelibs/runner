import { task } from "@bluelibs/runner";
import { z } from "zod";
import { httpRoute } from "#/http/tags";

export const healthz = task({
  id: "app.http.tasks.healthz",
  meta: {
    title: "Health Check",
    description: "Liveness probe endpoint",
  },
  inputSchema: z.undefined(),
  resultSchema: z.object({ status: z.literal("ok") }),
  tags: [httpRoute.with({ method: "get", path: "/healthz" })],
  run: async () => ({ status: "ok" as const }),
});
