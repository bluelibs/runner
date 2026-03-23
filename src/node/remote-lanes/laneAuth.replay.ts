import { remoteLaneAuthUnauthorizedError } from "../../errors";

export interface RemoteLaneReplayProtector {
  markOrThrow(jti: string, expiresAtMs: number, laneId: string): void;
}

export function createRemoteLaneReplayProtector(
  maxEntries: number = 10_000,
): RemoteLaneReplayProtector {
  const entries = new Map<string, number>();

  const pruneExpired = (nowMs: number) => {
    for (const [jti, expiresAtMs] of entries) {
      if (expiresAtMs <= nowMs) {
        entries.delete(jti);
      }
    }
  };

  return {
    markOrThrow(jti, expiresAtMs, laneId) {
      const nowMs = Date.now();
      pruneExpired(nowMs);

      if (entries.has(jti)) {
        remoteLaneAuthUnauthorizedError.throw({
          laneId,
          reason: "token replay detected",
        });
      }

      entries.set(jti, expiresAtMs);

      if (entries.size <= maxEntries) {
        return;
      }

      const oldestKey = entries.keys().next().value;
      if (oldestKey) {
        entries.delete(oldestKey);
      }
    },
  };
}
