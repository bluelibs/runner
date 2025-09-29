import { r } from "@bluelibs/runner";
import { fastifyContext } from "#/http/fastify-context";
import { HTTPError } from "#/http/http-error";

export type AuthorizeConfig = {
  required?: boolean; // default true: user must be present
  roles?: string[]; // optional: allowed roles
};

/**
 * Authorization middleware for tasks.
 * - Ensures a user is present (unless required === false)
 * - Optionally enforces that the user has one of the allowed roles
 *
 * Role detection strategy:
 * - Prefer `fastifyContext.use().user?.role`
 * - Fallback to request header `x-user-role`
 */
export const authorize = r.middleware
  .task("http.middleware.task.authorize")
  .configSchema<AuthorizeConfig>({ parse: (x: any) => x })
  .run(async ({ task, next }, _deps, config) => {
    const { user, request } = fastifyContext.use();

    const required = config?.required ?? true;
    if (required && !user) {
      throw new HTTPError(401, "Unauthorized");
    }

    if (config?.roles && config.roles.length > 0) {
      const hdr = request?.headers?.["x-user-role"] as string | undefined;
      const role = (user as any)?.role || hdr;
      if (!role || !config.roles.includes(role)) {
        throw new HTTPError(403, "Forbidden");
      }
    }

    return next(task.input);
  })
  .build();
