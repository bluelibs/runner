/**
 * Authentication system for BlueLibs Runner
 * 
 * This module provides a complete authentication and authorization system including:
 * - User management with abstract storage interface
 * - JWT token authentication
 * - Password hashing and verification
 * - Role-based access control
 * - Request-scoped user context
 * - Authentication and authorization middleware
 * 
 * Basic usage:
 * ```typescript
 * import { globals, run, resource } from "@bluelibs/runner";
 * 
 * const app = resource({
 *   id: "app",
 *   register: [
 *     // Register auth system with configuration
 *     globals.auth.system.with({
 *       jwtSecret: "your-secret-key",
 *       defaultRoles: ["user"],
 *       allowRegistration: true
 *     })
 *   ],
 *   dependencies: { 
 *     registerUser: globals.auth.tasks.registerUser,
 *     authenticateUser: globals.auth.tasks.authenticateUser 
 *   },
 *   init: async (_, { registerUser, authenticateUser }) => {
 *     // Register a new user
 *     const result = await registerUser({
 *       email: "user@example.com",
 *       password: "securepassword123"
 *     });
 *     
 *     // Authenticate the user
 *     const auth = await authenticateUser({
 *       email: "user@example.com", 
 *       password: "securepassword123"
 *     });
 *     
 *     return { success: true };
 *   }
 * });
 * ```
 */

// Export types
export * from "./types";

// Export context
export { UserContext, getCurrentUser, isAuthenticated, hasRole, hasAllRoles } from "./context";

// Export stores
export { MemoryUserStore } from "./stores/MemoryUserStore";

// Export services
export { SimplePasswordHasher } from "./services/SimplePasswordHasher";
export { SimpleJWTManager } from "./services/SimpleJWTManager";
export { BasicPermissionChecker } from "./services/BasicPermissionChecker";

// Export resources
export { userStoreResource } from "./resources/userStore.resource";
export { passwordHasherResource } from "./resources/passwordHasher.resource";
export { jwtManagerResource } from "./resources/jwtManager.resource";
export { permissionCheckerResource } from "./resources/permissionChecker.resource";

// Export middleware
export { 
  authMiddleware, 
  requireAuthMiddleware, 
  requireRoles,
  requireRolesWithHierarchy,
  requirePermission,
  requireAdminMiddleware,
  requireAdminWithHierarchyMiddleware,
  requireSuperAdminMiddleware,
  requireUserManagementPermission,
  requireSystemConfigPermission,
  requireBillingPermission
} from "./middleware/auth.middleware";
export { 
  jwtMiddleware, 
  jwtBearerMiddleware, 
  jwtInputMiddleware 
} from "./middleware/jwt.middleware";

// Export tasks
export { registerUserTask } from "./tasks/registerUser.task";
export { authenticateUserTask } from "./tasks/authenticateUser.task";

// Export the complete auth system
import { defineIndex } from "../../define";
import { IAuthConfig } from "./types";
import { userStoreResource } from "./resources/userStore.resource";
import { passwordHasherResource } from "./resources/passwordHasher.resource";
import { jwtManagerResource } from "./resources/jwtManager.resource";
import { permissionCheckerResource } from "./resources/permissionChecker.resource";
import { registerUserTask } from "./tasks/registerUser.task";
import { authenticateUserTask } from "./tasks/authenticateUser.task";
import { authMiddleware } from "./middleware/auth.middleware";
import { jwtMiddleware } from "./middleware/jwt.middleware";

/**
 * Complete authentication system that can be registered as a single unit
 * This provides a factory function to create the auth system with configuration
 */
export function createAuthSystem(config: IAuthConfig) {
  return defineIndex({
    userStore: userStoreResource,
    passwordHasher: passwordHasherResource,
    jwtManager: jwtManagerResource.with(config),
    permissionChecker: permissionCheckerResource,
    registerUser: registerUserTask,
    authenticateUser: authenticateUserTask,
    authMiddleware,
    jwtMiddleware,
  });
}

// Create convenient exports for globals
export const authResources = {
  userStore: userStoreResource,
  passwordHasher: passwordHasherResource,
  jwtManager: jwtManagerResource,
  permissionChecker: permissionCheckerResource,
};

export const authTasks = {
  registerUser: registerUserTask,
  authenticateUser: authenticateUserTask,
};

export const authMiddlewares = {
  auth: authMiddleware,
  jwt: jwtMiddleware,
};