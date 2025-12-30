import { isNode } from "../platform";

export function getCallerFile(): string {
  const originalPrepare = Error.prepareStackTrace;
  try {
    // Prefer robust Node path with structured stack frames
    if (isNode()) {
      const err = new Error();
      Error.prepareStackTrace = (_err, stack) => stack as unknown as any;
      const stack = err.stack as unknown as Array<{
        getFileName?: () => string | null;
      }>;

      // Best-effort: skip current (this fn) and its caller, then read next frame
      stack.shift();
      stack.shift();
      const candidate = stack.shift();
      const file = candidate?.getFileName?.();
      // In Node, V8 always provides a filename for this frame; keep branchless for coverage
      return file as unknown as string;
    }

    // Browser/edge fallback: do not attempt fragile parsing; keep deterministic
    return "unknown";
  } finally {
    Error.prepareStackTrace = originalPrepare;
  }
}
