import { inspect, types } from "node:util";

const MAX_ENTRIES = 100;
const MAX_TEXT = 2000;

function textPreview(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

function errorName(error: object): string {
  let current: object | null = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if (types.isProxy(current)) break;
    const name: unknown = Object.getOwnPropertyDescriptor(
      current,
      "name",
    )?.value;
    if (typeof name === "string") return textPreview(name);
    current = Object.getPrototypeOf(current);
  }
  return "Error";
}

/** Bounds the value before inspection; custom inspectors and accessors never run. */
export function commandWriter(value: unknown): string {
  let remaining = MAX_ENTRIES;
  const seen = new WeakSet<object>();
  function preview(item: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 4) return "[Preview limit]";
    if (typeof item === "string") return textPreview(item);
    if (typeof item === "symbol")
      return `Symbol(${textPreview(item.description ?? "")})`;
    if (
      typeof item === "bigint" &&
      (item > 10n ** 100n || item < -(10n ** 100n))
    )
      return "[Large BigInt]";
    if (typeof item === "function") return "[Function]";
    if (item === null || typeof item !== "object") return item;
    if (types.isProxy(item)) return "[Proxy]";
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    if (types.isNativeError(item)) {
      const message: unknown = Object.getOwnPropertyDescriptor(
        item,
        "message",
      )?.value;
      return `${errorName(item)}: ${typeof message === "string" ? textPreview(message) : "[No message]"}`;
    }
    if (types.isDate(item)) return new Date(Date.prototype.getTime.call(item));
    if (types.isMap(item) || types.isSet(item)) {
      const entries: unknown[] = [];
      const iterator = types.isMap(item)
        ? Map.prototype.entries.call(item)
        : Set.prototype.values.call(item);
      for (const entry of iterator) {
        if (remaining <= 0) {
          entries.push("[Preview limit]");
          break;
        }
        entries.push(preview(entry, depth + 1));
      }
      return { entries };
    }
    const result: Record<string, unknown> | unknown[] = Array.isArray(item)
      ? []
      : {};
    for (const key in item) {
      if (remaining <= 0) {
        Object.defineProperty(result, "…", {
          value: "[Preview limit]",
          enumerable: true,
        });
        break;
      }
      // Count inherited keys too, so a large prototype cannot bypass the budget.
      --remaining;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor) continue;
      Object.defineProperty(result, textPreview(key), {
        value:
          "value" in descriptor
            ? preview(descriptor.value, depth + 1)
            : "[Accessor]",
        enumerable: true,
        configurable: true,
      });
    }
    return result;
  }
  return inspect(preview(value, 0), {
    customInspect: false,
    getters: false,
    depth: 6,
    maxArrayLength: MAX_ENTRIES,
    maxStringLength: MAX_TEXT,
  });
}
