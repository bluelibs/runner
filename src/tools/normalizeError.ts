export function normalizeError(input: unknown): Error {
  return input instanceof Error ? input : new Error(String(input));
}
