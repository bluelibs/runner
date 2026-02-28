export type RemoteLaneAuthMode = "none" | "jwt_hmac" | "jwt_asymmetric";

export type RemoteLaneJwtAsymmetricAlgorithm = "EdDSA" | "ES256" | "RS256";

export interface RemoteLaneBindingAuthNone {
  mode: "none";
}

export interface RemoteLaneBindingAuthJwtHmac {
  mode?: "jwt_hmac";
  header?: string;
  tokenTtlMs?: number;
  clockSkewMs?: number;
  /**
   * Shared secret used for both produce+consume paths.
   * Use produceSecret/consumeSecret for split trust boundaries.
   */
  secret?: string;
  produceSecret?: string;
  consumeSecret?: string;
}

export interface RemoteLaneBindingAuthJwtAsymmetric {
  mode: "jwt_asymmetric";
  header?: string;
  algorithm?: RemoteLaneJwtAsymmetricAlgorithm;
  tokenTtlMs?: number;
  clockSkewMs?: number;
  /**
   * Private key used to sign outbound lane tokens.
   */
  privateKey?: string;
  /**
   * kid attached to produced tokens when privateKey is present.
   */
  privateKeyKid?: string;
  /**
   * Single public key used for token verification.
   */
  publicKey?: string;
  /**
   * Keyset used to resolve verification key by token kid.
   */
  publicKeysByKid?: Record<string, string>;
}

export type RemoteLaneBindingAuth =
  | RemoteLaneBindingAuthNone
  | RemoteLaneBindingAuthJwtHmac
  | RemoteLaneBindingAuthJwtAsymmetric;
