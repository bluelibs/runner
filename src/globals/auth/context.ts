import { createContext } from "../../context";
import { IUser } from "./types";

/**
 * Context for storing the current authenticated user
 * Use this to access user information across tasks and resources
 */
export interface IUserContext {
  user: IUser;
  token?: string;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * User context instance for the authentication system
 * 
 * Usage:
 * ```typescript
 * // In middleware or entry point:
 * await UserContext.provide({ user: authenticatedUser }, async () => {
 *   // All tasks within this scope can access the user
 *   await someTask();
 * });
 * 
 * // In tasks or resources:
 * const { user } = UserContext.use();
 * console.log(`Current user: ${user.email}`);
 * ```
 */
export const UserContext = createContext<IUserContext>("auth.userContext");

/**
 * Helper to get just the user from context
 */
export function getCurrentUser(): IUser {
  const context = UserContext.use();
  return context.user;
}

/**
 * Helper to check if user is authenticated
 */
export function isAuthenticated(): boolean {
  try {
    UserContext.use();
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to check if current user has specific roles
 */
export function hasRole(...roles: string[]): boolean {
  try {
    const { user } = UserContext.use();
    return roles.some(role => user.roles.includes(role));
  } catch {
    return false;
  }
}

/**
 * Helper to check if current user has all specified roles
 */
export function hasAllRoles(...roles: string[]): boolean {
  try {
    const { user } = UserContext.use();
    return roles.every(role => user.roles.includes(role));
  } catch {
    return false;
  }
}