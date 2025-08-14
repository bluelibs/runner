import { defineMiddleware } from "../../../define";
import { AuthenticationError, AuthorizationError } from "../types";
import { UserContext } from "../context";

/**
 * Configuration for authentication middleware
 */
export interface AuthMiddlewareConfig {
  /**
   * Whether authentication is required (default: true)
   */
  required?: boolean;

  /**
   * Required roles for access
   */
  roles?: string[];

  /**
   * Check if user must have ALL roles or ANY role (default: "any")
   */
  roleCheck?: "any" | "all";

  /**
   * Custom authorization function
   */
  authorize?: (user: any) => boolean | Promise<boolean>;

  /**
   * Custom error message for unauthorized access
   */
  unauthorizedMessage?: string;

  /**
   * Custom error message for insufficient permissions
   */
  forbiddenMessage?: string;
}

/**
 * Authentication middleware that requires a user to be authenticated
 * and optionally checks for specific roles or permissions
 * 
 * Usage:
 * ```typescript
 * const protectedTask = task({
 *   id: "protected.task",
 *   middleware: [
 *     authMiddleware.with({ 
 *       roles: ["admin"], 
 *       roleCheck: "any" 
 *     })
 *   ],
 *   run: async () => {
 *     const { user } = UserContext.use();
 *     return `Hello ${user.email}`;
 *   }
 * });
 * ```
 */
export const authMiddleware = defineMiddleware({
  id: "globals.auth.middleware.auth",
  async run({ task, resource, next }, deps, config: AuthMiddlewareConfig) {
    const required = config.required ?? true;
    
    // Check if user context exists
    let userContext;
    try {
      userContext = UserContext.use();
    } catch {
      if (required) {
        throw new AuthenticationError(
          config.unauthorizedMessage || "Authentication required"
        );
      }
      // If not required and no user context, proceed without authentication
      const input = task ? task.input : resource?.config;
      return next(input);
    }

    const { user } = userContext;

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError("User account is not active");
    }

    // Check roles if specified
    if (config.roles && config.roles.length > 0) {
      const hasRequiredRole = config.roleCheck === "all" 
        ? config.roles.every(role => user.roles.includes(role))
        : config.roles.some(role => user.roles.includes(role));

      if (!hasRequiredRole) {
        const roleRequirement = config.roleCheck === "all" ? "all" : "one";
        throw new AuthorizationError(
          config.forbiddenMessage || 
          `User must have ${roleRequirement} of the following roles: ${config.roles.join(", ")}`
        );
      }
    }

    // Custom authorization check
    if (config.authorize) {
      const authorized = await config.authorize(user);
      if (!authorized) {
        throw new AuthorizationError(
          config.forbiddenMessage || "Access denied"
        );
      }
    }

    // Proceed with the operation
    const input = task ? task.input : resource?.config;
    return next(input);
  },
});

/**
 * Shorthand middleware for requiring authentication without role checks
 */
export const requireAuthMiddleware = authMiddleware.with({ required: true });

/**
 * Helper to create role-based middleware
 */
export function requireRoles(roles: string[], roleCheck: "any" | "all" = "any") {
  return authMiddleware.with({ roles, roleCheck });
}

/**
 * Helper for admin-only middleware
 */
export const requireAdminMiddleware = authMiddleware.with({ 
  roles: ["admin", "super_admin"], 
  roleCheck: "any" 
});

/**
 * Helper for super admin-only middleware
 */
export const requireSuperAdminMiddleware = authMiddleware.with({ 
  roles: ["super_admin"] 
});