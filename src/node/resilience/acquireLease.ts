/** Cancels acquisition promptly and releases a grant that arrives after cancellation. */
export function acquireCancellableLease<T>(options: {
  acquire: () => Promise<T | null>;
  release: (grant: T) => Promise<unknown>;
  signal: AbortSignal;
}): Promise<T | null> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => options.signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      settled = true;
      cleanup();
      reject(options.signal.reason);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    void options.acquire().then(
      (grant) => {
        if (settled) {
          if (grant !== null) void options.release(grant).catch(() => {});
          return;
        }
        settled = true;
        cleanup();
        resolve(grant);
      },
      (error: unknown) => {
        cleanup();
        if (!settled) reject(error);
      },
    );
  });
}
