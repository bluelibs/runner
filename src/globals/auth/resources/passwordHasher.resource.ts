import { defineResource } from "../../../define";
import { IAuthConfig } from "../types";
import { SimplePasswordHasher } from "../services/SimplePasswordHasher";

/**
 * Password hasher resource for secure password handling
 */
export const passwordHasherResource = defineResource({
  id: "globals.auth.resources.passwordHasher",
  init: async (config: { hasher?: any } = {}) => {
    // If a custom hasher is provided, use it
    if (config.hasher) {
      return config.hasher;
    }
    
    // Default to simple hasher
    return new SimplePasswordHasher();
  },
  meta: {
    title: "Password Hasher",
    description: "Provides secure password hashing and verification",
    tags: ["auth", "security"],
  },
});