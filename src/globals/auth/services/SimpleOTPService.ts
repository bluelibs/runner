import { randomBytes, randomInt } from "node:crypto";
import {
  IOTPService,
  IOTPToken,
  IOTPVerificationResult,
  OTPType,
  InvalidOTPError,
} from "../types";

/**
 * Configuration for OTP service
 */
export interface IOTPConfig {
  /**
   * OTP expiration time in seconds (default: 300 - 5 minutes)
   */
  expirationSeconds?: number;

  /**
   * OTP code length for numeric codes (default: 6)
   */
  codeLength?: number;

  /**
   * Maximum verification attempts per OTP (default: 3)
   */
  maxAttempts?: number;

  /**
   * Code type: 'numeric' | 'alphanumeric' (default: 'numeric')
   */
  codeType?: "numeric" | "alphanumeric";
}

/**
 * OTP attempt tracking
 */
interface IOTPAttempt {
  tokenId: string;
  attempts: number;
  lastAttempt: Date;
}

/**
 * Simple memory-based OTP service
 * In production, use a database or distributed cache
 */
export class SimpleOTPService implements IOTPService {
  private tokens: Map<string, IOTPToken> = new Map();
  private userTokens: Map<string, Map<OTPType, string[]>> = new Map(); // userId -> type -> tokenIds
  private userOTPEnabled: Map<string, Set<OTPType>> = new Map(); // userId -> enabled types
  private attempts: Map<string, IOTPAttempt> = new Map(); // tokenId -> attempts
  private config: Required<IOTPConfig>;

  constructor(config: IOTPConfig = {}) {
    this.config = {
      expirationSeconds: config.expirationSeconds ?? 300,
      codeLength: config.codeLength ?? 6,
      maxAttempts: config.maxAttempts ?? 3,
      codeType: config.codeType ?? "numeric",
    };
  }

  async generateOTP(userId: string, type: OTPType, metadata?: Record<string, any>): Promise<IOTPToken> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.expirationSeconds * 1000);

    // Generate unique token ID
    const tokenId = randomBytes(16).toString("hex");

    // Generate OTP code
    const code = this.generateCode();

    const token: IOTPToken = {
      id: tokenId,
      userId,
      type,
      code,
      expiresAt,
      createdAt: now,
      used: false,
      metadata: metadata || {},
    };

    // Store the token
    this.tokens.set(tokenId, token);

    // Track user tokens
    if (!this.userTokens.has(userId)) {
      this.userTokens.set(userId, new Map());
    }
    const userTypeTokens = this.userTokens.get(userId)!;
    if (!userTypeTokens.has(type)) {
      userTypeTokens.set(type, []);
    }
    userTypeTokens.get(type)!.push(tokenId);

    return { ...token };
  }

  async verifyOTP(userId: string, code: string, type?: OTPType): Promise<IOTPVerificationResult> {
    // Find valid tokens for the user
    const userTypeTokens = this.userTokens.get(userId);
    if (!userTypeTokens) {
      return { success: false };
    }

    const now = new Date();
    let foundToken: IOTPToken | null = null;

    // Search through user's tokens
    for (const [tokenType, tokenIds] of userTypeTokens.entries()) {
      if (type && tokenType !== type) {
        continue; // Skip if specific type requested and doesn't match
      }

      for (const tokenId of tokenIds) {
        const token = this.tokens.get(tokenId);
        if (!token || token.used || now > token.expiresAt) {
          continue;
        }

        if (token.code === code) {
          foundToken = token;
          break;
        }
      }

      if (foundToken) {
        break;
      }
    }

    if (!foundToken) {
      return { success: false };
    }

    // Check attempts
    const attemptKey = foundToken.id;
    let attempt = this.attempts.get(attemptKey);
    if (!attempt) {
      attempt = {
        tokenId: foundToken.id,
        attempts: 0,
        lastAttempt: now,
      };
    }

    attempt.attempts++;
    attempt.lastAttempt = now;
    this.attempts.set(attemptKey, attempt);

    if (attempt.attempts > this.config.maxAttempts) {
      // Mark token as used to prevent further attempts
      this.tokens.set(foundToken.id, {
        ...foundToken,
        used: true,
      });
      return { 
        success: false, 
        remaining: 0 
      };
    }

    // Success - mark token as used
    this.tokens.set(foundToken.id, {
      ...foundToken,
      used: true,
    });

    return {
      success: true,
      token: { ...foundToken },
      remaining: this.config.maxAttempts - attempt.attempts,
    };
  }

  async isOTPEnabled(userId: string, type: OTPType): Promise<boolean> {
    const enabledTypes = this.userOTPEnabled.get(userId);
    return enabledTypes ? enabledTypes.has(type) : false;
  }

  async enableOTP(userId: string, type: OTPType, metadata?: Record<string, any>): Promise<void> {
    if (!this.userOTPEnabled.has(userId)) {
      this.userOTPEnabled.set(userId, new Set());
    }
    this.userOTPEnabled.get(userId)!.add(type);
  }

  async disableOTP(userId: string, type: OTPType): Promise<void> {
    const enabledTypes = this.userOTPEnabled.get(userId);
    if (enabledTypes) {
      enabledTypes.delete(type);
      if (enabledTypes.size === 0) {
        this.userOTPEnabled.delete(userId);
      }
    }

    // Clean up any existing tokens for this user/type
    const userTypeTokens = this.userTokens.get(userId);
    if (userTypeTokens) {
      const tokenIds = userTypeTokens.get(type) || [];
      for (const tokenId of tokenIds) {
        this.tokens.delete(tokenId);
        this.attempts.delete(tokenId);
      }
      userTypeTokens.delete(type);
      if (userTypeTokens.size === 0) {
        this.userTokens.delete(userId);
      }
    }
  }

  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();
    const tokensToDelete: string[] = [];

    for (const [tokenId, token] of this.tokens.entries()) {
      if (now > token.expiresAt || token.used) {
        tokensToDelete.push(tokenId);
      }
    }

    for (const tokenId of tokensToDelete) {
      const token = this.tokens.get(tokenId);
      if (token) {
        // Remove from user tracking
        const userTypeTokens = this.userTokens.get(token.userId);
        if (userTypeTokens) {
          const typeTokens = userTypeTokens.get(token.type);
          if (typeTokens) {
            const index = typeTokens.indexOf(tokenId);
            if (index >= 0) {
              typeTokens.splice(index, 1);
            }
            if (typeTokens.length === 0) {
              userTypeTokens.delete(token.type);
              if (userTypeTokens.size === 0) {
                this.userTokens.delete(token.userId);
              }
            }
          }
        }
      }

      this.tokens.delete(tokenId);
      this.attempts.delete(tokenId);
    }
  }

  /**
   * Generate OTP code based on configuration
   */
  private generateCode(): string {
    if (this.config.codeType === "numeric") {
      const min = Math.pow(10, this.config.codeLength - 1);
      const max = Math.pow(10, this.config.codeLength) - 1;
      return randomInt(min, max + 1).toString();
    } else {
      // Alphanumeric
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let result = "";
      for (let i = 0; i < this.config.codeLength; i++) {
        result += chars.charAt(randomInt(0, chars.length));
      }
      return result;
    }
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.tokens.clear();
    this.userTokens.clear();
    this.userOTPEnabled.clear();
    this.attempts.clear();
  }

  /**
   * Get active token count for user (for testing)
   */
  async getActiveTokenCount(userId: string, type?: OTPType): Promise<number> {
    const userTypeTokens = this.userTokens.get(userId);
    if (!userTypeTokens) {
      return 0;
    }

    const now = new Date();
    let count = 0;

    for (const [tokenType, tokenIds] of userTypeTokens.entries()) {
      if (type && tokenType !== type) {
        continue;
      }

      for (const tokenId of tokenIds) {
        const token = this.tokens.get(tokenId);
        if (token && !token.used && now <= token.expiresAt) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Get enabled OTP types for user (for testing)
   */
  async getEnabledTypes(userId: string): Promise<OTPType[]> {
    const enabledTypes = this.userOTPEnabled.get(userId);
    return enabledTypes ? Array.from(enabledTypes) : [];
  }
}