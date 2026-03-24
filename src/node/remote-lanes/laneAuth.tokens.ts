import * as crypto from "node:crypto";
import type { RemoteLaneBindingAuth } from "../../defs";
import {
  remoteLaneAuthSignerMissingError,
  remoteLaneAuthUnauthorizedError,
  remoteLaneAuthVerifierMissingError,
} from "../../errors";
import {
  resolveAsymmetricKid,
  resolveAsymmetricPrivateKey,
  resolveAsymmetricPublicKey,
  resolveHmacSecret,
} from "./laneAuth.binding";
import {
  parseLaneJwt,
  signLaneJwtWithAsymmetric,
  signLaneJwtWithHmac,
  verifyLaneJwtAsymmetricSignature,
  verifyLaneJwtHmacSignature,
} from "./laneAuth.jwt";
import { resolveLaneAuthPolicy } from "./laneAuth.policy";
import type { RemoteLaneReplayProtector } from "./laneAuth.replay";
import type { RemoteLaneTokenTarget } from "./laneAuth.subject";

type LaneCapability = "produce" | "consume";

export interface RemoteLaneTokenIssueInput {
  laneId: string;
  bindingAuth?: RemoteLaneBindingAuth;
  capability: LaneCapability;
  target?: RemoteLaneTokenTarget;
  nowMs?: number;
}

export interface RemoteLaneTokenVerifyInput {
  laneId: string;
  bindingAuth?: RemoteLaneBindingAuth;
  token: string;
  requiredCapability: LaneCapability;
  expectedTarget?: Partial<RemoteLaneTokenTarget>;
  nowMs?: number;
  replayProtector?: RemoteLaneReplayProtector;
  consumeReplay?: boolean;
}

export function issueRemoteLaneToken({
  laneId,
  bindingAuth,
  capability,
  target,
  nowMs = Date.now(),
}: RemoteLaneTokenIssueInput): string | undefined {
  const resolvedPolicy = resolveLaneAuthPolicy(bindingAuth);
  if (resolvedPolicy.mode === "none") {
    return undefined;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + resolvedPolicy.tokenTtlMs) / 1000);
  const payload = {
    lane: laneId,
    cap: capability,
    kind: target?.kind,
    target: target?.targetId,
    hash: target?.payloadHash,
    jti: crypto.randomUUID(),
    iat,
    exp,
  } as const;

  if (resolvedPolicy.mode === "jwt_hmac") {
    const secret = resolveHmacSecret(bindingAuth, "produce");
    if (!secret) {
      remoteLaneAuthSignerMissingError.throw({
        laneId,
        mode: resolvedPolicy.mode,
      });
    }
    return signLaneJwtWithHmac({ alg: "HS256", typ: "JWT" }, payload, secret!);
  }

  const privateKey = resolveAsymmetricPrivateKey(bindingAuth);
  if (!privateKey) {
    remoteLaneAuthSignerMissingError.throw({
      laneId,
      mode: resolvedPolicy.mode,
    });
  }

  return signLaneJwtWithAsymmetric({
    header: {
      alg: resolvedPolicy.algorithm,
      typ: "JWT",
      kid: resolveAsymmetricKid(bindingAuth),
    },
    payload,
    privateKey: privateKey!,
    algorithm: resolvedPolicy.algorithm,
  });
}

export function verifyRemoteLaneToken({
  laneId,
  bindingAuth,
  token,
  requiredCapability,
  expectedTarget,
  nowMs = Date.now(),
  replayProtector,
  consumeReplay = true,
}: RemoteLaneTokenVerifyInput): void {
  const resolvedPolicy = resolveLaneAuthPolicy(bindingAuth);
  if (resolvedPolicy.mode === "none") {
    return;
  }

  const parsed = parseLaneJwt(token, laneId);
  const { header, payload, encoded, signature } = parsed;

  if (payload.lane !== laneId) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "token lane claim mismatch",
    });
  }
  if (payload.cap !== requiredCapability) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: `token capability "${payload.cap}" does not allow "${requiredCapability}"`,
    });
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const skewSeconds = Math.floor(resolvedPolicy.clockSkewMs / 1000);
  if (payload.exp < nowSeconds - skewSeconds) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "token expired",
    });
  }
  if (payload.iat > nowSeconds + skewSeconds) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "token issued in the future",
    });
  }

  if (expectedTarget?.kind && payload.kind !== expectedTarget.kind) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: `token target kind "${payload.kind ?? "unknown"}" does not allow "${expectedTarget.kind}"`,
    });
  }
  if (expectedTarget?.targetId && payload.target !== expectedTarget.targetId) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: `token target "${payload.target ?? "unknown"}" does not allow "${expectedTarget.targetId}"`,
    });
  }
  if (
    expectedTarget?.payloadHash &&
    payload.hash !== expectedTarget.payloadHash
  ) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "token payload hash mismatch",
    });
  }

  if (resolvedPolicy.mode === "jwt_hmac") {
    if (header.alg !== "HS256") {
      remoteLaneAuthUnauthorizedError.throw({
        laneId,
        reason: `unexpected JWT alg "${header.alg}"`,
      });
    }
    const secret = resolveHmacSecret(bindingAuth, "consume");
    if (!secret) {
      remoteLaneAuthVerifierMissingError.throw({
        laneId,
        mode: resolvedPolicy.mode,
      });
    }
    const verified = verifyLaneJwtHmacSignature({
      encoded,
      signature,
      secret: secret!,
    });
    if (!verified) {
      remoteLaneAuthUnauthorizedError.throw({
        laneId,
        reason: "invalid signature",
      });
    }
  } else {
    if (header.alg !== resolvedPolicy.algorithm) {
      remoteLaneAuthUnauthorizedError.throw({
        laneId,
        reason: `unexpected JWT alg "${header.alg}"`,
      });
    }
    const publicKey = resolveAsymmetricPublicKey({
      bindingAuth,
      kid: header.kid,
    });
    if (!publicKey) {
      remoteLaneAuthVerifierMissingError.throw({
        laneId,
        mode: resolvedPolicy.mode,
      });
    }

    const verified = verifyLaneJwtAsymmetricSignature({
      encoded,
      signature,
      publicKey: publicKey!,
      algorithm: resolvedPolicy.algorithm,
    });
    if (!verified) {
      remoteLaneAuthUnauthorizedError.throw({
        laneId,
        reason: "invalid signature",
      });
    }
  }

  if (consumeReplay && replayProtector && payload.jti) {
    replayProtector.markOrThrow(
      payload.jti,
      (payload.exp + skewSeconds) * 1000,
      laneId,
    );
  }
}
