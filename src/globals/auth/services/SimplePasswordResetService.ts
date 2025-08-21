import { randomBytes } from "node:crypto";
import {
  IPasswordResetService,
  IPasswordResetToken,
  InvalidPasswordResetTokenError,
} from "../types";

/**
 * Configuration for password reset service
 */
export interface IPasswordResetConfig {
  /**
   * Token expiration time in seconds (default: 3600 - 1 hour)
   */
  tokenExpirationSeconds?: number;

  /**
   * Token length in bytes (default: 32)
   */
  tokenLength?: number;
}

/**
 * Simple memory-based password reset service
 * In production, use a database or distributed cache
 */
export class SimplePasswordResetService implements IPasswordResetService {
  private tokens: Map<string, IPasswordResetToken> = new Map();
  private config: Required<IPasswordResetConfig>;

  constructor(config: IPasswordResetConfig = {}) {
    this.config = {
      tokenExpirationSeconds: config.tokenExpirationSeconds ?? 3600,
      tokenLength: config.tokenLength ?? 32,
    };
  }

  async generateResetToken(email: string): Promise<IPasswordResetToken> {
    // Generate a cryptographically secure random token
    const tokenBuffer = randomBytes(this.config.tokenLength);
    const token = tokenBuffer.toString("hex");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.tokenExpirationSeconds * 1000);

    const resetToken: IPasswordResetToken = {
      token,
      email,
      expiresAt,
      createdAt: now,
      used: false,
    };

    // Clean up any existing tokens for this email first
    await this.cleanupTokensForEmail(email);

    this.tokens.set(token, resetToken);
    return resetToken;
  }

  async verifyResetToken(token: string): Promise<IPasswordResetToken> {
    const resetToken = this.tokens.get(token);

    if (!resetToken) {
      throw new InvalidPasswordResetTokenError();
    }

    const now = new Date();
    if (now > resetToken.expiresAt) {
      // Token has expired, remove it
      this.tokens.delete(token);
      throw new InvalidPasswordResetTokenError();
    }

    if (resetToken.used) {
      throw new InvalidPasswordResetTokenError();
    }

    return { ...resetToken };
  }

  async markTokenAsUsed(token: string): Promise<void> {
    const resetToken = this.tokens.get(token);
    if (resetToken) {
      this.tokens.set(token, {
        ...resetToken,
        used: true,
      });
    }
  }

  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();
    const tokensToDelete: string[] = [];

    for (const [token, resetToken] of this.tokens.entries()) {
      if (now > resetToken.expiresAt || resetToken.used) {
        tokensToDelete.push(token);
      }
    }

    for (const token of tokensToDelete) {
      this.tokens.delete(token);
    }
  }

  /**
   * Clean up tokens for a specific email (when generating new token)
   */
  private async cleanupTokensForEmail(email: string): Promise<void> {
    const tokensToDelete: string[] = [];

    for (const [token, resetToken] of this.tokens.entries()) {
      if (resetToken.email === email) {
        tokensToDelete.push(token);
      }
    }

    for (const token of tokensToDelete) {
      this.tokens.delete(token);
    }
  }

  /**
   * Clear all tokens (for testing)
   */
  async clear(): Promise<void> {
    this.tokens.clear();
  }

  /**
   * Get token count (for testing)
   */
  getTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Find token by email (for testing)
   */
  async findTokenByEmail(email: string): Promise<IPasswordResetToken | null> {
    for (const resetToken of this.tokens.values()) {
      if (resetToken.email === email && !resetToken.used) {
        const now = new Date();
        if (now <= resetToken.expiresAt) {
          return { ...resetToken };
        }
      }
    }
    return null;
  }
}