import { defineResource } from "../../../define";
import { SimplePasswordResetService, IPasswordResetConfig } from "../services/SimplePasswordResetService";

/**
 * Password reset service resource
 */
export const passwordResetServiceResource = defineResource({
  id: "globals.auth.resources.passwordResetService",
  async init(config: IPasswordResetConfig = {}) {
    return new SimplePasswordResetService(config);
  },
  meta: {
    title: "Password Reset Service",
    description: "Handles password reset token generation and verification",
    tags: ["auth", "password", "reset"],
  },
});