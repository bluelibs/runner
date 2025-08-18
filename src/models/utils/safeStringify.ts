export function safeStringify(
  value: unknown,
  space?: number,
  options?: { maxDepth?: number },
): string {
  const seen = new WeakSet<object>();
  const holderDepth = new WeakMap<object, number>();

  const maxDepth =
    typeof options?.maxDepth === "number" ? options!.maxDepth! : Infinity;

  const replacer = function (this: any, _key: string, val: any) {
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
  } as (this: any, key: string, value: any) => any;

  try {
    return JSON.stringify(value as any, replacer, space);
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable]";
    }
  }
}
