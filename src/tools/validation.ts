import { ValidationAdapter } from "../defs";

/**
 * Uniformly parse a value using either a Zod‑like object { parse() } or a
 * function adapter. The return value can be sync or async; we always await.
 */
export async function validateWithAdapter<T>(
  adapter: ValidationAdapter<T>,
  value: unknown
): Promise<T> {
  try {
    if (typeof adapter === "function") {
      return await adapter(value);
    }
    return await adapter.parse(value);
  } catch (e: any) {
    // Surface both the thrown error and any structured issues if present.
    const issues = e?.issues ?? e?.details ?? undefined;
    const err = new Error("Schema validation failed");
    (err as any).cause = e;
    if (issues) (err as any).issues = issues;
    throw err;
  }
}
