import * as crypto from "node:crypto";

export type RemoteLaneTokenTargetKind = "rpc-task" | "rpc-event" | "event-lane";

export interface RemoteLaneTokenTarget {
  kind: RemoteLaneTokenTargetKind;
  targetId: string;
  payloadHash?: string;
}

export function hashRemoteLanePayload(payload: string): string {
  return crypto.createHash("sha256").update(payload).digest("base64url");
}
