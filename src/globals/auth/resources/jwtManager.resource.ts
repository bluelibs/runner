import { defineResource } from "../../../define";
import { IAuthConfig } from "../types";
import { SimpleJWTManager } from "../services/SimpleJWTManager";

/**
 * JWT manager resource for token handling
 */
export const jwtManagerResource = defineResource({
  id: "globals.auth.resources.jwtManager",
  init: async (config: IAuthConfig) => {
    if (!config.jwtSecret) {
      throw new Error("JWT secret is required in auth configuration");
    }
    
    // If a custom manager is provided, use it
    if ((config as any).jwtManager) {
      return (config as any).jwtManager;
    }
    
    // Default to simple JWT manager
    return new SimpleJWTManager(
      config.jwtSecret,
      config.jwtExpiresIn || 24 * 60 * 60 // 24 hours default
    );
  },
  meta: {
    title: "JWT Manager",
    description: "Provides JWT token generation and verification",
    tags: ["auth", "security", "jwt"],
  },
});