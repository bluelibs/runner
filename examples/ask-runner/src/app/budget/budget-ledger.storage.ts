import type {
  AuditEntry,
  BudgetLedgerState,
  BudgetLedgerStorageLimits,
  DayState,
  RateWindowState,
} from "./budget-ledger.types";

const overflowIpKey = "__overflow__";

/**
 * Returns the tracked day state for `day`, creating it and pruning old days
 * when needed.
 */
export function ensureLedgerDayState(
  state: BudgetLedgerState,
  day: string,
  storageLimits: BudgetLedgerStorageLimits,
): DayState {
  const existing = state.dayStateByDay.get(day);
  if (existing) return existing;

  const created: DayState = {
    spentUsd: 0,
    requestCount: 0,
    stopped: false,
    stopReason: null,
  };
  state.dayStateByDay.set(day, created);
  pruneDayStates(state, day, storageLimits);
  return created;
}

/**
 * Increments the count for one bucket/ip window, collapsing excess unique IPs
 * into an overflow bucket when tracking limits are reached.
 */
export function incrementWindowCount(
  window: RateWindowState,
  bucket: string,
  ip: string,
  maxTrackedIps: number,
): number {
  const countsByIp = ensureWindowBucket(window, bucket);
  const trackedIpKey = resolveTrackedIpKey(countsByIp, ip, maxTrackedIps);
  const next = (countsByIp.get(trackedIpKey) ?? 0) + 1;
  countsByIp.set(trackedIpKey, next);
  return next;
}

/**
 * Appends an audit entry while keeping the audit trail bounded in memory.
 */
export function appendBoundedAuditEntry(
  state: BudgetLedgerState,
  entry: AuditEntry,
  storageLimits: BudgetLedgerStorageLimits,
): void {
  state.audit.push(entry);
  if (state.audit.length <= storageLimits.maxAuditEntries) return;

  state.audit.splice(0, state.audit.length - storageLimits.maxAuditEntries);
}

function pruneDayStates(
  state: BudgetLedgerState,
  currentDay: string,
  storageLimits: BudgetLedgerStorageLimits,
): void {
  while (state.dayStateByDay.size > storageLimits.maxTrackedDays) {
    const oldestDay = state.dayStateByDay.keys().next().value;
    if (!oldestDay || oldestDay === currentDay) return;
    state.dayStateByDay.delete(oldestDay);
  }
}

function ensureWindowBucket(
  window: RateWindowState,
  bucket: string,
): Map<string, number> {
  if (window.bucket !== bucket) {
    window.bucket = bucket;
    window.countsByIp.clear();
  }

  return window.countsByIp;
}

function resolveTrackedIpKey(
  countsByIp: Map<string, number>,
  ip: string,
  maxTrackedIps: number,
): string {
  if (countsByIp.has(ip)) return ip;

  if (countsByIp.has(overflowIpKey)) {
    return countsByIp.size <= maxTrackedIps ? ip : overflowIpKey;
  }

  return countsByIp.size < maxTrackedIps ? ip : overflowIpKey;
}
