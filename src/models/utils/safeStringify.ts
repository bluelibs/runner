export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, val: any) => {
    if (typeof val === "bigint") {
      return val.toString();
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  };
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
