import type { IncomingHttpHeaders } from "http";
import type { RemoteLaneBindingAuth } from "../../defs";
import {
  remoteLaneAuthSignerMissingError,
  remoteLaneAuthVerifierMissingError,
} from "../../errors";
import {
  resolveAsymmetricPrivateKey,
  resolveAsymmetricPublicKey,
  resolveHmacSecret,
} from "./laneAuth.binding";
import { readHeaderValue } from "./laneAuth.jwt";
import { resolveLaneAuthPolicy } from "./laneAuth.policy";

export function assertRemoteLaneSignerConfigured(
  laneId: string,
  bindingAuth?: RemoteLaneBindingAuth,
): void {
  const resolvedPolicy = resolveLaneAuthPolicy(bindingAuth);
  if (resolvedPolicy.mode === "none") {
    return;
  }

  if (resolvedPolicy.mode === "jwt_hmac") {
    if (resolveHmacSecret(bindingAuth, "produce")) {
      return;
    }
    remoteLaneAuthSignerMissingError.throw({
      laneId,
      mode: resolvedPolicy.mode,
    });
  }

  if (!resolveAsymmetricPrivateKey(bindingAuth)) {
    remoteLaneAuthSignerMissingError.throw({
      laneId,
      mode: resolvedPolicy.mode,
    });
  }
}

export function assertRemoteLaneVerifierConfigured(
  laneId: string,
  bindingAuth?: RemoteLaneBindingAuth,
): void {
  const resolvedPolicy = resolveLaneAuthPolicy(bindingAuth);
  if (resolvedPolicy.mode === "none") {
    return;
  }

  if (resolvedPolicy.mode === "jwt_hmac") {
    if (resolveHmacSecret(bindingAuth, "consume")) {
      return;
    }
    remoteLaneAuthVerifierMissingError.throw({
      laneId,
      mode: resolvedPolicy.mode,
    });
  }

  if (!resolveAsymmetricPublicKey({ bindingAuth })) {
    remoteLaneAuthVerifierMissingError.throw({
      laneId,
      mode: resolvedPolicy.mode,
    });
  }
}

export function getRemoteLaneAuthHeaderName(
  bindingAuth?: RemoteLaneBindingAuth,
): string {
  return resolveLaneAuthPolicy(bindingAuth).header;
}

export function readRemoteLaneTokenFromHeaders(
  headers: IncomingHttpHeaders,
  bindingAuth?: RemoteLaneBindingAuth,
): string | undefined {
  const headerName = getRemoteLaneAuthHeaderName(bindingAuth);
  const value = readHeaderValue(headers[headerName]);
  if (!value) {
    return undefined;
  }

  if (headerName !== "authorization") {
    return value;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (match?.[1]) {
    return match[1].trim();
  }
  return value.trim();
}

export function writeRemoteLaneTokenToHeaders(
  headers: Record<string, string>,
  bindingAuth: RemoteLaneBindingAuth | undefined,
  token: string,
): void {
  const headerName = getRemoteLaneAuthHeaderName(bindingAuth);
  headers[headerName] =
    headerName === "authorization" ? `Bearer ${token}` : token;
}
