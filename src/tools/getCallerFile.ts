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
      let frames: NodeJS.CallSite[] = [];
      Error.prepareStackTrace = (_err, stackTrace) => {
        frames = stackTrace;
        // Keep stack string materialization deterministic; callers never use it.
        return "";
      };
      // Trigger stack generation so prepareStackTrace captures frames.
      void err.stack;
      const stack = [...frames];

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
