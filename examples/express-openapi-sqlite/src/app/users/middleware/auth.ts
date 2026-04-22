import { r } from "@bluelibs/runner";
import jwt from "jsonwebtoken";
import { UserContext } from "../contexts/user.context";
import { usersRepository } from "../resources/users-repository.resource";
import { UserSession } from "../types";
import { appConfig } from "../../app.config";
import { unauthorizedError } from "../errors/auth.error";

export interface AuthMiddlewareConfig {
  requiresAuth?: boolean;
}

export const authMiddleware = r.middleware
  .task<AuthMiddlewareConfig>("auth")
  .dependencies({ userService: usersRepository, appConfig })
  .run(async ({ task, next }, { userService, appConfig }, config) => {
    const { jwtSecret } = appConfig;
    const { requiresAuth = true } = config;

    // For HTTP tasks, we expect the request to be available in task.input
    const request = task?.input?.request;

    if (!request) {
      // Non-HTTP task, skip auth
      return next(task?.input);
    }

    // Extract token from Authorization header
    const authHeader = request.headers?.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token && requiresAuth) {
      throw unauthorizedError.new({ message: "Authentication required" });
    }

    if (token) {
      try {
        // Verify JWT token
        const decoded = jwt.verify(token, jwtSecret) as { id: string };

        // Get user from database
        const user = await userService.getUserById(decoded.id);

        if (!user) {
          throw unauthorizedError.new({ message: "Invalid or expired token" });
        }

        // Create user session
        const userSession: UserSession = {
          id: user.id,
          email: user.email,
          name: user.name,
        };

        // Provide user context for the duration of the task
        return UserContext.provide(userSession, () => next(task?.input));
      } catch (error) {
        if (requiresAuth) {
          throw unauthorizedError.new({ message: "Invalid or expired token" });
        }
        // If auth is optional and token is invalid, continue without user context
      }
    }

    return next(task?.input);
  })
  .build();
