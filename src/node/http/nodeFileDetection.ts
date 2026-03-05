import type { Readable } from "stream";

/**
 * Checks whether a value quacks like a Node.js Readable stream.
 */
export function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as { pipe?: unknown }).pipe === "function";
}

/**
 * Recursively searches a value graph for Runner Node-file sentinels
 * (`{ $runnerFile: "File", _node: { stream | buffer } }`).
 * Used by HTTP clients to decide between JSON vs multipart transport.
 */
export function hasNodeFile(value: unknown): boolean {
  const isNodeFileSentinel = (
    v: unknown,
  ): v is {
    $runnerFile: "File";
    id: string;
    _node?: { stream?: unknown; buffer?: unknown };
  } => {
    if (!v || typeof v !== "object") return false;
    const rec = v as Record<string, unknown>;
    if (rec.$runnerFile !== "File") return false;
    if (typeof rec.id !== "string") return false;
    const node = rec._node;
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    return Boolean(n.stream || n.buffer);
  };

  const visit = (v: unknown): boolean => {
    if (isNodeFileSentinel(v)) return true;
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(visit);
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (visit((v as Record<string, unknown>)[k])) return true;
    }
    return false;
  };
  return visit(value);
}
