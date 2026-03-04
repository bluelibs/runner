export function createHttpChildLogger(
  baseLogger: any,
  meta: { requestId: string; method: string; path: string },
) {
  return baseLogger.with({
    source: "http",
    additionalContext: {
      requestId: meta.requestId,
      method: meta.method,
      path: meta.path,
    },
  });
}
