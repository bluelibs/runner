import * as crypto from "node:crypto";
import { remoteLaneAuthUnauthorizedError } from "../../errors";
import type { RemoteLaneJwtAsymmetricAlgorithm } from "../../defs";

export interface LaneJwtHeader {
  alg: "HS256" | RemoteLaneJwtAsymmetricAlgorithm;
  typ: "JWT";
  kid?: string;
}

export interface LaneJwtPayload {
  lane: string;
  cap: "produce" | "consume";
  kind?: "rpc-task" | "rpc-event" | "event-lane";
  target?: string;
  hash?: string;
  jti?: string;
  iat: number;
  exp: number;
}

export interface ParsedLaneJwt {
  header: LaneJwtHeader;
  payload: LaneJwtPayload;
  encoded: string;
  signature: string;
}

export function signLaneJwtWithHmac(
  header: LaneJwtHeader,
  payload: LaneJwtPayload,
  secret: string,
): string {
  const encodedHeader = encodeJwtPart(header);
  const encodedPayload = encodeJwtPart(payload);
  const encoded = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function signLaneJwtWithAsymmetric(options: {
  header: LaneJwtHeader;
  payload: LaneJwtPayload;
  privateKey: string;
  algorithm: RemoteLaneJwtAsymmetricAlgorithm;
}): string {
  const { header, payload, privateKey, algorithm } = options;
  const encodedHeader = encodeJwtPart(header);
  const encodedPayload = encodeJwtPart(payload);
  const encoded = `${encodedHeader}.${encodedPayload}`;
  const data = Buffer.from(encoded);

  const signatureBuffer =
    algorithm === "EdDSA"
      ? crypto.sign(null, data, privateKey)
      : crypto.sign("sha256", data, privateKey);
  return `${encoded}.${signatureBuffer.toString("base64url")}`;
}

export function verifyLaneJwtHmacSignature(options: {
  encoded: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", options.secret)
    .update(options.encoded)
    .digest();
  const received = base64UrlToBuffer(options.signature);
  return safeEqual(expected, received);
}

export function verifyLaneJwtAsymmetricSignature(options: {
  encoded: string;
  signature: string;
  publicKey: string;
  algorithm: RemoteLaneJwtAsymmetricAlgorithm;
}): boolean {
  try {
    const data = Buffer.from(options.encoded);
    const signatureBuffer = base64UrlToBuffer(options.signature);
    return options.algorithm === "EdDSA"
      ? crypto.verify(null, data, options.publicKey, signatureBuffer)
      : crypto.verify("sha256", data, options.publicKey, signatureBuffer);
  } catch {
    return false;
  }
}

export function parseLaneJwt(token: string, laneId: string): ParsedLaneJwt {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "malformed JWT",
    });
  }

  const header = parseJwtPart<LaneJwtHeader>(headerPart!, laneId);
  const payload = parseJwtPart<LaneJwtPayload>(payloadPart!, laneId);

  if (
    typeof payload.lane !== "string" ||
    typeof payload.cap !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    remoteLaneAuthUnauthorizedError.throw({
      laneId,
      reason: "invalid JWT payload",
    });
  }

  return {
    header,
    payload,
    encoded: `${headerPart}.${payloadPart}`,
    signature: signaturePart!,
  };
}

export function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function parseJwtPart<T>(part: string, laneId: string): T {
  try {
    const text = base64UrlToBuffer(part).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    throw remoteLaneAuthUnauthorizedError.new({
      laneId,
      reason: "invalid JWT encoding",
    });
  }
}

function encodeJwtPart(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function base64UrlToBuffer(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  return Buffer.from(withPadding, "base64");
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
