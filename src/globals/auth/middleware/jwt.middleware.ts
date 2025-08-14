import { defineMiddleware } from "../../../define";
import { AuthenticationError, InvalidTokenError } from "../types";
import { UserContext } from "../context";
import { userStoreResource } from "../resources/userStore.resource";
import { jwtManagerResource } from "../resources/jwtManager.resource";

/**
 * Configuration for JWT middleware
 */
export interface JWTMiddlewareConfig {
  /**
   * Whether to refresh user data from store (default: false)
   */
  refreshUser?: boolean;

  /**
   * How to extract the token from input
   * - "header": Extract from Authorization header (Bearer token)
   * - "input": Extract from task input or resource config
   * - "context": Extract from existing context
   */
  tokenSource?: "header" | "input" | "context";

  /**
   * Property name in input to extract token from (when tokenSource is "input")
   */
  tokenProperty?: string;

  /**
   * Custom token extractor function
   */
  extractToken?: (input: any) => string | null;
}

/**
 * JWT authentication middleware that extracts and validates JWT tokens
 * and populates the UserContext with the authenticated user
 * 
 * Usage:
 * ```typescript
 * const apiTask = task({
 *   id: "api.task",
 *   middleware: [
 *     jwtMiddleware.with({ 
 *       tokenSource: "input",
 *       tokenProperty: "authorization" 
 *     })
 *   ],
 *   run: async (input) => {
 *     const { user } = UserContext.use();
 *     return `Hello ${user.email}`;
 *   }
 * });
 * ```
 */
export const jwtMiddleware = defineMiddleware({
  id: "globals.auth.middleware.jwt",
  dependencies: {
    jwtManager: jwtManagerResource,
    userStore: userStoreResource,
  },
  async run({ task, resource, next }, { jwtManager, userStore }, config: JWTMiddlewareConfig = {}) {
    const input = task ? task.input : resource?.config;
    
    // Extract token based on configuration
    let token: string | null = null;
    
    if (typeof config.extractToken === 'function') {
      token = config.extractToken(input);
    } else {
      switch (config.tokenSource) {
        case "header":
          // Assume input has headers property (e.g., from Express request)
          if (input?.headers?.authorization) {
            const authHeader = input.headers.authorization as string;
            if (authHeader.startsWith("Bearer ")) {
              token = authHeader.substring(7);
            }
          }
          break;
          
        case "input":
          const property = config.tokenProperty || "token";
          token = input?.[property] || null;
          break;
          
        case "context":
          try {
            const currentContext = UserContext.use();
            token = currentContext.token || null;
          } catch {
            // No existing context
          }
          break;
          
        default:
          // Try common token locations
          if (input?.headers?.authorization?.startsWith("Bearer ")) {
            token = input.headers.authorization.substring(7);
          } else {
            token = input?.token || input?.authorization || null;
          }
          break;
      }
    }

    if (!token) {
      throw new AuthenticationError("No authentication token provided");
    }

    try {
      // Verify the JWT token
      const payload = await jwtManager.verify(token);
      
      // Get user data
      let user;
      if (config.refreshUser) {
        // Fetch fresh user data from store
        user = await userStore.findById(payload.userId);
        if (!user) {
          throw new AuthenticationError("User not found");
        }
      } else {
        // Use data from JWT payload (faster but potentially stale)
        user = {
          id: payload.userId,
          email: payload.email,
          roles: payload.roles,
          isActive: true, // JWT wouldn't be valid if user was inactive when issued
          createdAt: new Date(), // We don't have this data in JWT
          updatedAt: new Date(),
        };
      }

      // Create user context
      const userContext = {
        user,
        token,
        requestId: input?.requestId,
        sessionId: input?.sessionId,
        metadata: input?.metadata,
      };

      // Provide user context for the duration of the operation
      return await UserContext.provide(userContext, () => next(input));
      
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new AuthenticationError(`Invalid token: ${error.message}`);
      }
      throw error;
    }
  },
});

/**
 * Helper middleware for Bearer token authentication from headers
 */
export const jwtBearerMiddleware = jwtMiddleware.with({ 
  tokenSource: "header" 
});

/**
 * Helper middleware for token authentication from input
 */
export const jwtInputMiddleware = jwtMiddleware.with({ 
  tokenSource: "input",
  tokenProperty: "token" 
});