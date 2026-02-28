import type {
  RemoteLaneBindingAuth,
  RemoteLaneJwtAsymmetricAlgorithm,
} from "../../defs";

const DEFAULT_HEADER = "authorization";
const DEFAULT_TOKEN_TTL_MS = 60_000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;

export type ResolvedLaneAuthPolicy =
  | {
      mode: "none";
      header: string;
      tokenTtlMs: number;
      clockSkewMs: number;
    }
  | {
      mode: "jwt_hmac";
      header: string;
      tokenTtlMs: number;
      clockSkewMs: number;
    }
  | {
      mode: "jwt_asymmetric";
      header: string;
      tokenTtlMs: number;
      clockSkewMs: number;
      algorithm: RemoteLaneJwtAsymmetricAlgorithm;
    };

export function resolveLaneAuthPolicy(
  bindingAuth?: RemoteLaneBindingAuth,
): ResolvedLaneAuthPolicy {
  if (!bindingAuth || bindingAuth.mode === "none") {
    return {
      mode: "none",
      header: DEFAULT_HEADER,
      tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
      clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
    };
  }

  if (bindingAuth.mode === "jwt_asymmetric") {
    return {
      mode: "jwt_asymmetric",
      algorithm: bindingAuth.algorithm ?? "EdDSA",
      header: (bindingAuth.header ?? DEFAULT_HEADER).toLowerCase(),
      tokenTtlMs: bindingAuth.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS,
      clockSkewMs: bindingAuth.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS,
    };
  }

  return {
    mode: "jwt_hmac",
    header: (bindingAuth.header ?? DEFAULT_HEADER).toLowerCase(),
    tokenTtlMs: bindingAuth.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS,
    clockSkewMs: bindingAuth.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS,
  };
}
