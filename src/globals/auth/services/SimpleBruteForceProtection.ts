import {
  IBruteForceProtection,
  IBruteForceAttempt,
  TooManyAttemptsError,
} from "../types";

/**
 * Configuration for brute force protection
 */
export interface IBruteForceConfig {
  /**
   * Maximum failed attempts before locking (default: 5)
   */
  maxAttempts?: number;

  /**
   * Initial cooldown period in seconds (default: 60)
   */
  initialCooldownSeconds?: number;

  /**
   * Cooldown multiplier for exponential backoff (default: 2)
   */
  cooldownMultiplier?: number;

  /**
   * Maximum cooldown period in seconds (default: 3600 - 1 hour)
   */
  maxCooldownSeconds?: number;

  /**
   * Time window to reset attempts in seconds (default: 3600 - 1 hour)
   */
  resetWindowSeconds?: number;
}

/**
 * Simple memory-based brute force protection service
 * In production, use a distributed cache like Redis
 */
export class SimpleBruteForceProtection implements IBruteForceProtection {
  private attempts: Map<string, IBruteForceAttempt> = new Map();
  private config: Required<IBruteForceConfig>;

  constructor(config: IBruteForceConfig = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 5,
      initialCooldownSeconds: config.initialCooldownSeconds ?? 60,
      cooldownMultiplier: config.cooldownMultiplier ?? 2,
      maxCooldownSeconds: config.maxCooldownSeconds ?? 3600,
      resetWindowSeconds: config.resetWindowSeconds ?? 3600,
    };
  }

  async recordFailedAttempt(email: string): Promise<void> {
    const now = new Date();
    const existing = this.attempts.get(email);

    if (!existing) {
      // First failed attempt
      this.attempts.set(email, {
        email,
        attempts: 1,
        lastAttempt: now,
      });
      return;
    }

    // Check if we should reset attempts due to time window
    const timeSinceLastAttempt = now.getTime() - existing.lastAttempt.getTime();
    if (timeSinceLastAttempt > this.config.resetWindowSeconds * 1000) {
      this.attempts.set(email, {
        email,
        attempts: 1,
        lastAttempt: now,
      });
      return;
    }

    // Increment attempts
    const newAttempts = existing.attempts + 1;

    if (newAttempts >= this.config.maxAttempts) {
      // Calculate cooldown period with exponential backoff
      const cooldownPeriod = Math.min(
        this.config.initialCooldownSeconds * Math.pow(this.config.cooldownMultiplier, newAttempts - this.config.maxAttempts),
        this.config.maxCooldownSeconds
      );

      const cooldownUntil = new Date(now.getTime() + cooldownPeriod * 1000);

      this.attempts.set(email, {
        email,
        attempts: newAttempts,
        lastAttempt: now,
        cooldownUntil,
      });
    } else {
      this.attempts.set(email, {
        email,
        attempts: newAttempts,
        lastAttempt: now,
      });
    }
  }

  async isLocked(email: string): Promise<boolean> {
    const attempt = this.attempts.get(email);
    if (!attempt || !attempt.cooldownUntil) {
      return false;
    }

    const now = new Date();
    if (now >= attempt.cooldownUntil) {
      // Cooldown has expired, remove it
      this.attempts.set(email, {
        ...attempt,
        cooldownUntil: undefined,
      });
      return false;
    }

    return true;
  }

  async getCooldownUntil(email: string): Promise<Date | null> {
    const attempt = this.attempts.get(email);
    if (!attempt || !attempt.cooldownUntil) {
      return null;
    }

    const now = new Date();
    if (now >= attempt.cooldownUntil) {
      // Cooldown has expired
      return null;
    }

    return attempt.cooldownUntil;
  }

  async resetAttempts(email: string): Promise<void> {
    this.attempts.delete(email);
  }

  async clear(): Promise<void> {
    this.attempts.clear();
  }

  /**
   * Check if email is locked and throw error if so
   */
  async checkAndThrowIfLocked(email: string): Promise<void> {
    if (await this.isLocked(email)) {
      const cooldownUntil = await this.getCooldownUntil(email);
      throw new TooManyAttemptsError(cooldownUntil!);
    }
  }

  /**
   * Get current attempt count for email (for testing)
   */
  async getAttemptCount(email: string): Promise<number> {
    return this.attempts.get(email)?.attempts ?? 0;
  }
}