import { defineResource } from "../../../define";
import { SimpleBruteForceProtection, IBruteForceConfig } from "../services/SimpleBruteForceProtection";

/**
 * Brute force protection resource
 */
export const bruteForceProtectionResource = defineResource({
  id: "globals.auth.resources.bruteForceProtection",
  async init(config: IBruteForceConfig = {}) {
    return new SimpleBruteForceProtection(config);
  },
  meta: {
    title: "Brute Force Protection",
    description: "Protects against brute force attacks with exponential backoff",
    tags: ["auth", "security", "brute-force"],
  },
});