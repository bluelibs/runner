export function throwDashboardApiRequestError(message: string): never {
  // Dashboard client only needs a plain surfaced error for UI handling.
  throw new Error(message);
}
