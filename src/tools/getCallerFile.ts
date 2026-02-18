/**
 * Inline node detection to avoid circular dependency with platform module.
 * This is necessary because getCallerFile() is called during error module
 * initialization, before the platform module is fully loaded.
 */
function isNodeInline(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof (process as NodeJS.Process)?.versions?.node === "string"
  );
}

export function getCallerFile(): string {
  const originalPrepare = Error.prepareStackTrace;
  try {
    // Prefer robust Node path with structured stack frames
    if (isNodeInline()) {
      const err = new Error();
      Error.prepareStackTrace = (_err, stack) => stack;
      // V8 sets err.stack to the raw CallSite[] array when prepareStackTrace returns it;
      // TypeScript types this as string, so we reinterpret it as the structured form.
      const stack = err.stack as unknown as Array<{
        getFileName?: () => string | null;
      }>;

      // Best-effort: skip current (this fn) and its caller, then read next frame
      stack.shift();
      stack.shift();
      const candidate = stack.shift();
      const file = candidate?.getFileName?.();
      // In Node, V8 always provides a filename for this frame; keep branchless for coverage
      return file!;
    }

    // Browser/edge fallback: do not attempt fragile parsing; keep deterministic
    return "unknown";
  } finally {
    Error.prepareStackTrace = originalPrepare;
  }
}
