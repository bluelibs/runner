import { defineMiddleware } from "../../../define";
import { AuthenticationError, AuthorizationError } from "../types";
import { UserContext } from "../context";
import { permissionCheckerResource } from "../resources/permissionChecker.resource";

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
   * Resource name for permission checking
   */
  resource?: string;

  /**
   * Action name for permission checking
   */
  action?: string;

  /**
   * Use permission checker for authorization instead of direct role checks (default: false)
   * When true, will use the permissionChecker resource for authorization
   */
  usePermissionChecker?: boolean;

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
 * // Role-based access control
 * const adminTask = task({
 *   id: "admin.task",
 *   middleware: [
 *     authMiddleware.with({ 
 *       roles: ["admin"], 
 *       roleCheck: "any" 
 *     })
 *   ],
 *   run: async () => {
 *     const { user } = UserContext.use();
 *     return `Hello admin ${user.email}`;
 *   }
 * });
 * 
 * // Permission-based access control
 * const userManagementTask = task({
 *   id: "user.management.task",
 *   middleware: [
 *     authMiddleware.with({ 
 *       resource: "user_management",
 *       usePermissionChecker: true
 *     })
 *   ],
 *   run: async () => {
 *     const { user } = UserContext.use();
 *     return `Managing users as ${user.email}`;
 *   }
 * });
 * ```
 */
export const authMiddleware = defineMiddleware({
  id: "globals.auth.middleware.auth",
  dependencies: {
    permissionChecker: permissionCheckerResource,
  },
  async run({ task, resource, next }, { permissionChecker }, config: AuthMiddlewareConfig) {
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

    // Authorization checks - use permission checker if configured
    if (config.usePermissionChecker && (config.resource || config.action)) {
      const hasPermission = await permissionChecker.hasPermission({
        user,
        resource: config.resource,
        action: config.action,
      });

      if (!hasPermission) {
        const resourceInfo = config.resource ? ` for resource '${config.resource}'` : '';
        const actionInfo = config.action ? ` action '${config.action}'` : '';
        throw new AuthorizationError(
          config.forbiddenMessage || 
          `Access denied${resourceInfo}${actionInfo}`
        );
      }
    }
    // Fallback to direct role checking if not using permission checker
    else if (config.roles && config.roles.length > 0) {
      let hasRequiredRole = false;
      
      if (config.usePermissionChecker) {
        // Use permission checker for role validation (includes role hierarchy)
        hasRequiredRole = config.roleCheck === "all" 
          ? await permissionChecker.hasAllRoles(user, config.roles)
          : await permissionChecker.hasRole(user, config.roles);
      } else {
        // Direct role checking (legacy behavior for backward compatibility)
        hasRequiredRole = config.roleCheck === "all" 
          ? config.roles.every(role => user.roles.includes(role))
          : config.roles.some(role => user.roles.includes(role));
      }

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
 * Helper to create role-based middleware using permission checker (includes role hierarchy)
 */
export function requireRolesWithHierarchy(roles: string[], roleCheck: "any" | "all" = "any") {
  return authMiddleware.with({ roles, roleCheck, usePermissionChecker: true });
}

/**
 * Helper to create permission-based middleware for specific resources
 */
export function requirePermission(resource: string, action?: string) {
  return authMiddleware.with({ 
    resource, 
    action, 
    usePermissionChecker: true 
  });
}

/**
 * Helper for admin-only middleware (direct role check)
 */
export const requireAdminMiddleware = authMiddleware.with({ 
  roles: ["admin", "super_admin"], 
  roleCheck: "any" 
});

/**
 * Helper for admin-only middleware using permission checker (with role hierarchy)
 */
export const requireAdminWithHierarchyMiddleware = authMiddleware.with({ 
  roles: ["admin"], 
  roleCheck: "any",
  usePermissionChecker: true
});

/**
 * Helper for super admin-only middleware
 */
export const requireSuperAdminMiddleware = authMiddleware.with({ 
  roles: ["super_admin"] 
});

/**
 * Common permission-based middleware helpers
 */
export const requireUserManagementPermission = requirePermission("user_management");
export const requireSystemConfigPermission = requirePermission("system_config");
export const requireBillingPermission = requirePermission("billing");