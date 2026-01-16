export function safeStringify(
  value: unknown,
  space?: number,
  options?: { maxDepth?: number },
): string {
  const seen = new WeakSet<object>();
  const holderDepth = new WeakMap<object, number>();

  const maxDepth =
    typeof options?.maxDepth === "number" ? options.maxDepth : Infinity;

  const replacer = function (this: unknown, _key: string, val: unknown) {
    // Normalize functions to a readable placeholder
    if (typeof val === "function") {
      return "function()";
    }

    // Normalize BigInt safely
    if (typeof val === "bigint") {
      return val.toString();
    }

    // Compute the depth of the current value based on its holder (this)
    const holderObject = Object(this);
    const parentDepth = holderDepth.get(holderObject as object) || 0;
    const currentDepth = parentDepth + 1;

    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";

      // Apply depth limiting beyond the configured depth
      if (currentDepth > maxDepth) {
        return Array.isArray(val) ? "[Array]" : "[Object]";
      }

      seen.add(val);
      holderDepth.set(val, currentDepth);
    }
    return val;
  } as (this: unknown, key: string, value: unknown) => unknown;

  try {
    // JSON.stringify's replacer type is complex (overloaded). Our replacer satisfies
    // the (key: string, value: unknown) => unknown signature used at runtime.
    return JSON.stringify(value, replacer as (key: string, value: unknown) => unknown, space);
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable]";
    }
  }
}
