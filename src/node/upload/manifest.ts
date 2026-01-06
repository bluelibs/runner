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

type AnyObj = Record<string, any>;

/**
 * Walk an input object and collect File sentinels having local Node sources.
 * It returns a shallow-cloned structure where any internal _node fields are removed.
 */
export function buildNodeManifest<T = any>(input: T): BuiltManifest<T> {
  const files: NodeFileSource[] = [];

  function visit(value: any): any {
    if (!value || typeof value !== "object") return value;
    // Detect File sentinel with optional _node sidecar
    if (
      (value as RunnerFileSentinel).$runnerFile === "File" &&
      typeof (value as any).id === "string"
    ) {
      const v: any = value;
      const id: string = v.id;
      const meta: InputFileMeta = v.meta;
      const local = v._node as
        | { buffer?: Buffer; stream?: Readable }
        | undefined;
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
      const copy: AnyObj = { $runnerFile: "File", id, meta };
      return copy;
    }

    if (Array.isArray(value)) {
      return value.map((x) => visit(x));
    }

    const out: AnyObj = {};
    for (const k of Object.keys(value)) {
      out[k] = visit((value as AnyObj)[k]);
    }
    return out;
  }

  const cloned = visit(input);
  return { input: cloned, files } as BuiltManifest<T>;
}
