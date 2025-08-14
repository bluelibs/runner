import { IJWTManager, IJWTPayload, InvalidTokenError } from "../types";

/**
 * Simple JWT manager using Node.js crypto module
 * For production use, consider using a library like 'jsonwebtoken'
 */
export class SimpleJWTManager implements IJWTManager {
  constructor(
    private readonly secret: string,
    private readonly expiresInSeconds: number = 24 * 60 * 60 // 24 hours
  ) {}

  async generate(payload: IJWTPayload): Promise<string> {
    const crypto = await import("crypto");
    
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + this.expiresInSeconds,
    };

    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = this.base64urlEncode(JSON.stringify(header));
    const encodedPayload = this.base64urlEncode(JSON.stringify(fullPayload));
    
    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verify(token: string): Promise<IJWTPayload> {
    const crypto = await import("crypto");
    
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new InvalidTokenError("Invalid token format");
    }

    const [headerB64, payloadB64, signature] = parts;
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    if (signature !== expectedSignature) {
      throw new InvalidTokenError("Invalid token signature");
    }

    // Decode payload
    let payload: IJWTPayload;
    try {
      payload = JSON.parse(this.base64urlDecode(payloadB64));
    } catch {
      throw new InvalidTokenError("Invalid token payload");
    }

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Token has expired");
    }

    return payload;
  }

  async isExpired(token: string): Promise<boolean> {
    try {
      await this.verify(token);
      return false;
    } catch (error) {
      if (error instanceof InvalidTokenError && error.message.includes("expired")) {
        return true;
      }
      throw error;
    }
  }

  private base64urlEncode(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  private base64urlDecode(str: string): string {
    // Add padding if needed
    const padding = "=".repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + padding;
    return Buffer.from(base64, "base64").toString();
  }
}