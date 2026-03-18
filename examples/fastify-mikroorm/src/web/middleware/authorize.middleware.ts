import { r } from "@bluelibs/runner";
import { fastifyContext } from "#/web/fastify-context";
import { HTTPError } from "#/web/http-error";

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
 * - Only trust `fastifyContext.use().user?.role`
 * - Never trust request headers for authorization decisions
 */
export const authorize = r.middleware
  .task("authorize")
  .configSchema<AuthorizeConfig>({ parse: (x: unknown) => x as AuthorizeConfig })
  .run(async ({ task, next }, _deps, config) => {
    const { user } = fastifyContext.use();

    const required = config?.required ?? true;
    if (required && !user) {
      throw new HTTPError(401, "Unauthorized");
    }

    if (config?.roles && config.roles.length > 0) {
      const role = (user as { role?: string } | null | undefined)?.role;
      if (!role || !config.roles.includes(role)) {
        throw new HTTPError(403, "Forbidden");
      }
    }

    return next(task.input);
  })
  .build();
