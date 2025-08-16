import { IPasswordHasher } from "../types";

/**
 * Simple password hasher using Node.js crypto module
 * For production use, consider using bcrypt, scrypt, or argon2
 */
export class SimplePasswordHasher implements IPasswordHasher {
  private readonly iterations = 100000;
  private readonly keyLength = 64;
  private readonly digest = "sha256";

  async hash(password: string): Promise<string> {
    const crypto = await import("crypto");
    
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto
      .pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.digest)
      .toString("hex");
    
    return `${salt}:${hash}`;
  }

  async verify(password: string, hashedPassword: string): Promise<boolean> {
    try {
      const crypto = await import("crypto");
      
      const [salt, hash] = hashedPassword.split(":");
      if (!salt || !hash) {
        return false;
      }

      const testHash = crypto
        .pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.digest)
        .toString("hex");

      return hash === testHash;
    } catch {
      return false;
    }
  }
}