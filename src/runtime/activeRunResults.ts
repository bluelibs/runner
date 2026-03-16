import type { RunResult } from "../models/RunResult";

const activeRunResults = new Set<RunResult<any>>();

export function registerActiveRunResult(runtime: RunResult<any>): void {
  activeRunResults.add(runtime);
}

export function unregisterActiveRunResult(runtime: RunResult<any>): void {
  activeRunResults.delete(runtime);
}

export function snapshotActiveRunResults(): ReadonlySet<RunResult<any>> {
  return new Set(activeRunResults);
}
