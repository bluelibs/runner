import path from "path";

export function toPosixPath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

export function isInCoverageScope(relPosix) {
  // Keep this aligned with `jest.config.js` -> `collectCoverageFrom`.
  // This is used only for *display/counting* coverage output, so it should
  // mirror what Jest instruments and enforces thresholds for.
  if (!relPosix.startsWith("src/")) return false;
  if (relPosix.endsWith(".d.ts")) return false;
  if (!(relPosix.endsWith(".ts") || relPosix.endsWith(".tsx"))) return false;
  if (relPosix.includes("/__tests__/")) return false;
  if (relPosix.startsWith("src/node/durable/dashboard/")) return false;
  return true;
}

export function toCoverageScopedRelPosixPath(absPath) {
  const rel = path.relative(process.cwd(), absPath);
  return toPosixPath(rel);
}
