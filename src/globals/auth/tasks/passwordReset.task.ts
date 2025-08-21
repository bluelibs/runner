import { defineTask } from "../../../define";
import {
  IPasswordResetRequest,
  IPasswordResetCompletion,
  IPasswordResetService,
  IUserStore,
  IPasswordHasher,
  UserNotFoundError,
  InvalidPasswordResetTokenError,
} from "../types";

/**
 * Task to initiate password reset process
 * Generates a reset token and returns it (to be sent via email)
 */
export const initiatePasswordResetTask = defineTask({
  id: "globals.auth.tasks.initiatePasswordReset",
  dependencies: {
    userStore: "globals.auth.resources.userStore",
    passwordResetService: "globals.auth.resources.passwordResetService",
  },
  async run(
    request: IPasswordResetRequest,
    { userStore, passwordResetService }: {
      userStore: IUserStore;
      passwordResetService: IPasswordResetService;
    }
  ) {
    // Validate that user exists
    const user = await userStore.findByEmail(request.email);
    if (!user) {
      throw new UserNotFoundError(request.email);
    }

    // Generate reset token
    const resetToken = await passwordResetService.generateResetToken(request.email);

    return {
      token: resetToken.token,
      expiresAt: resetToken.expiresAt,
      email: request.email,
      callbackUrl: request.callbackUrl,
      metadata: request.metadata,
    };
  },
  meta: {
    title: "Initiate Password Reset",
    description: "Generates a password reset token for a user",
    tags: ["auth", "password", "reset"],
  },
});

/**
 * Task to complete password reset process
 * Verifies token and updates user password
 */
export const completePasswordResetTask = defineTask({
  id: "globals.auth.tasks.completePasswordReset",
  dependencies: {
    userStore: "globals.auth.resources.userStore",
    passwordResetService: "globals.auth.resources.passwordResetService",
    passwordHasher: "globals.auth.resources.passwordHasher",
  },
  async run(
    completion: IPasswordResetCompletion,
    { userStore, passwordResetService, passwordHasher }: {
      userStore: IUserStore;
      passwordResetService: IPasswordResetService;
      passwordHasher: IPasswordHasher;
    }
  ) {
    // Verify the reset token
    const resetToken = await passwordResetService.verifyResetToken(completion.token);

    // Find the user
    const user = await userStore.findByEmail(resetToken.email);
    if (!user) {
      throw new UserNotFoundError(resetToken.email);
    }

    // Hash the new password
    const hashedPassword = await passwordHasher.hash(completion.newPassword);

    // Update the user's password
    const updatedUser = await userStore.updatePassword(user.id, hashedPassword);

    // Mark the reset token as used
    await passwordResetService.markTokenAsUsed(completion.token);

    return {
      success: true,
      user: updatedUser,
      message: "Password reset successfully",
    };
  },
  meta: {
    title: "Complete Password Reset",
    description: "Completes password reset using a valid token",
    tags: ["auth", "password", "reset"],
  },
});

/**
 * Task to verify a password reset token (without completing the reset)
 * Useful for validating tokens before showing reset form
 */
export const verifyPasswordResetTokenTask = defineTask({
  id: "globals.auth.tasks.verifyPasswordResetToken",
  dependencies: {
    passwordResetService: "globals.auth.resources.passwordResetService",
  },
  async run(
    { token }: { token: string },
    { passwordResetService }: { passwordResetService: IPasswordResetService }
  ) {
    try {
      const resetToken = await passwordResetService.verifyResetToken(token);
      return {
        valid: true,
        email: resetToken.email,
        expiresAt: resetToken.expiresAt,
      };
    } catch (error) {
      if (error instanceof InvalidPasswordResetTokenError) {
        return {
          valid: false,
          error: "Invalid or expired token",
        };
      }
      throw error;
    }
  },
  meta: {
    title: "Verify Password Reset Token",
    description: "Verifies a password reset token without completing the reset",
    tags: ["auth", "password", "reset", "verify"],
  },
});