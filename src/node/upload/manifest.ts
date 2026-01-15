import type { Readable } from "stream";
import type { RunnerFileSentinel, InputFileMeta } from "../../types/inputFile";

export interface NodeFileSource {
  id: string;
  meta: InputFileMeta;
  source:
    | { type: "buffer"; buffer: Buffer }
    | { type: "stream"; stream: Readable };
}

export interface BuiltManifest<T = any> {
  input: T; // cloned input with any client-only fields stripped out
  files: NodeFileSource[];
}

export type AnyObj = Record<string, unknown>;

/**
 * Walk an input object and collect File sentinels having local Node sources.
 * It returns a shallow-cloned structure where any internal _node fields are removed.
 */
export function buildNodeManifest<T>(input: T): BuiltManifest<T> {
  const files: NodeFileSource[] = [];

  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;

    // Detect File sentinel with optional _node sidecar
    const potentialFile = value as RunnerFileSentinel & {
      _node?: { buffer?: Buffer; stream?: Readable };
    };

    if (
      potentialFile.$runnerFile === "File" &&
      typeof potentialFile.id === "string"
    ) {
      const id = potentialFile.id;
      const meta = potentialFile.meta;
      const local = potentialFile._node;

      if (local?.buffer) {
        files.push({
          id,
          meta,
          source: { type: "buffer", buffer: local.buffer },
        });
      } else if (local?.stream) {
        files.push({
          id,
          meta,
          source: { type: "stream", stream: local.stream },
        });
      }
      // Strip _node from manifest copy
      const copy: RunnerFileSentinel = { $runnerFile: "File", id, meta };
      return copy;
    }

    if (Array.isArray(value)) {
      return value.map((x) => visit(x));
    }

    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      out[k] = visit(obj[k]);
    }
    return out;
  }

  const cloned = visit(input) as T;
  return { input: cloned, files };
}
