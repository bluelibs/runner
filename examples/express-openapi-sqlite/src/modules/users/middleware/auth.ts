import { middleware } from "@bluelibs/runner";
import jwt from "jsonwebtoken";
import { UserContext } from "../user.context";
import { usersRepository } from "../repository/users.repository";
import { UserSession } from "../types";
import { appConfig } from "../../app.config";

export interface AuthMiddlewareConfig {
  requiresAuth?: boolean;
}

export const authMiddleware = middleware({
  id: "app.middleware.auth",
  dependencies: { userService: usersRepository, appConfig },
  run: async (
    { task, next },
    { userService, appConfig },
    config: AuthMiddlewareConfig
  ) => {
    const { jwtSecret } = appConfig;
    const { requiresAuth = true } = config;

    // For HTTP tasks, we expect the request to be available in task.input
    const request = task?.input?.request;

    if (!request) {
      // Non-HTTP task, skip auth
      return next(task?.input);
    }

    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token && requiresAuth) {
      throw new Error("Authentication required");
    }

    if (token) {
      try {
        // Verify JWT token
        const decoded = jwt.verify(token, jwtSecret) as { userId: string };

        // Get user from database
        const user = await userService.getUserById(decoded.userId);

        if (!user) {
          throw new Error("User not found");
        }

        // Create user session
        const userSession: UserSession = {
          userId: user.id,
          email: user.email,
          name: user.name,
        };

        // Provide user context for the duration of the task
        return UserContext.provide(userSession, () => next(task?.input));
      } catch (error) {
        if (requiresAuth) {
          throw new Error("Invalid or expired token");
        }
        // If auth is optional and token is invalid, continue without user context
      }
    }

    return next(task?.input);
  },
});
