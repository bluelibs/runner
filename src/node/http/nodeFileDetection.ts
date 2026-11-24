import type { Readable } from "stream";

/**
 * Checks whether a value quacks like a Node.js Readable stream.
 */
export function isReadable(value: unknown): value is Readable {
  return !!value && typeof (value as { pipe?: unknown }).pipe === "function";
}

interface NodeFileTraversalState {
  seen: WeakSet<object> | undefined;
}

function isNodeFileSentinel(v: object): boolean {
  const rec = v as Record<string, unknown>;
  if (rec.$runnerFile !== "File") return false;
  if (typeof rec.id !== "string") return false;
  const node = rec._node;
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  return Boolean(n.stream || n.buffer);
}

function visitChild(
  child: unknown,
  parent: object,
  state: NodeFileTraversalState,
): boolean {
  if (typeof child !== "object" || child === null) return false;
  if (!state.seen) {
    state.seen = new WeakSet([parent]);
  }
  return visitObject(child, state);
}

function visitObject(v: object, state: NodeFileTraversalState): boolean {
  if (isNodeFileSentinel(v)) return true;
  if (state.seen) {
    // Circular graphs are valid serializer inputs. Guard against revisiting
    // the same object so cycle detection stays total instead of overflowing.
    if (state.seen.has(v)) return false;
    state.seen.add(v);
  }
  if (Array.isArray(v)) {
    return v.some((child) => visitChild(child, v, state));
  }
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec);
  for (let i = 0; i < keys.length; i++) {
    if (visitChild(rec[keys[i]], v, state)) return true;
  }
  return false;
}

/**
 * Recursively searches a value graph for Runner Node-file sentinels
 * (`{ $runnerFile: "File", _node: { stream | buffer } }`).
 * Used by HTTP clients to decide between JSON vs multipart transport.
 */
export function hasNodeFile(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return visitObject(value, { seen: undefined });
}
