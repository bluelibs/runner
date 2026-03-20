export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  } | null;
  output_tokens_details?: Record<string, unknown> | null;
}

export interface BudgetSnapshot {
  day: string;
  spentUsd: number;
  requestCount: number;
  stopped: boolean;
  stopReason: string | null;
  remainingUsd: number;
}

export interface DayState {
  spentUsd: number;
  requestCount: number;
  stopped: boolean;
  stopReason: string | null;
}

export interface AuditEntry {
  timestamp: string;
  day: string;
  ip: string;
  queryHash: string;
  model: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
  status: "ok" | "rejected";
}

export interface RateWindowState {
  bucket: string | null;
  countsByIp: Map<string, number>;
}

export interface BudgetLedgerState {
  dayStateByDay: Map<string, DayState>;
  minuteWindow: RateWindowState;
  hourWindow: RateWindowState;
  dayWindow: RateWindowState;
  audit: AuditEntry[];
}

export interface BudgetLedgerStorageLimits {
  maxAuditEntries: number;
  maxTrackedMinuteIps: number;
  maxTrackedHourIps: number;
  maxTrackedDayIps: number;
  maxTrackedDays: number;
}

export const defaultBudgetLedgerStorageLimits: BudgetLedgerStorageLimits = {
  maxAuditEntries: 2_000,
  maxTrackedMinuteIps: 2_000,
  maxTrackedHourIps: 10_000,
  maxTrackedDayIps: 20_000,
  maxTrackedDays: 7,
};

export interface BudgetLedger {
  enforceIpLimit(input: {
    day: string;
    minuteBucket: string;
    hourBucket: string;
    ip: string;
  }): void;
  ensureDayCanSpend(input: { day: string; projectedCostUsd: number }): void;
  recordUsage(input: {
    day: string;
    ip: string;
    query: string;
    model: string;
    estimatedCostUsd: number;
    usage: UsageLike | null;
    status: "ok" | "rejected";
  }): BudgetSnapshot;
  stopForDay(day: string, reason: string): BudgetSnapshot;
  resume(day: string): BudgetSnapshot;
  getSnapshot(day: string): BudgetSnapshot;
}

export function createBudgetLedgerState(): BudgetLedgerState {
  return {
    dayStateByDay: new Map(),
    minuteWindow: { bucket: null, countsByIp: new Map() },
    hourWindow: { bucket: null, countsByIp: new Map() },
    dayWindow: { bucket: null, countsByIp: new Map() },
    audit: [],
  };
}
