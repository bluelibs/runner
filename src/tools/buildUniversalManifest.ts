import type { Readable } from "stream";
import type { InputFileMeta, RunnerFileSentinel } from "../types/inputFile";

export interface NodeCollectedFile {
  id: string;
  meta: InputFileMeta;
  source:
    | { type: "buffer"; buffer: Buffer }
    | { type: "stream"; stream: Readable };
}

export interface WebCollectedFile {
  id: string;
  meta: InputFileMeta;
  blob: Blob;
}

export interface BuiltUniversalManifest<T = unknown> {
  input: T; // cloned input with sidecars removed
  nodeFiles: NodeCollectedFile[];
  webFiles: WebCollectedFile[];
}

type AnyObj = Record<string, unknown>;

/** Internal representation of a file value with platform-specific data */
interface InternalFileValue extends RunnerFileSentinel {
  _node?: { buffer?: Buffer; stream?: Readable };
  _web?: { blob?: Blob };
}

export function buildUniversalManifest<T = unknown>(
  input: T,
): BuiltUniversalManifest<T> {
  const nodeFiles: NodeCollectedFile[] = [];
  const webFiles: WebCollectedFile[] = [];

  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;

    if (
      (value as RunnerFileSentinel).$runnerFile === "File" &&
      typeof (value as RunnerFileSentinel).id === "string"
    ) {
      const v = value as InternalFileValue;
      const id: string = v.id;
      const meta: InputFileMeta = v.meta;
      const node = v._node;
      const web = v._web;

      if (node?.buffer) {
        nodeFiles.push({
          id,
          meta,
          source: { type: "buffer", buffer: node.buffer },
        });
      } else if (node?.stream) {
        nodeFiles.push({
          id,
          meta,
          source: { type: "stream", stream: node.stream },
        });
      } else if (web?.blob) {
        webFiles.push({ id, meta, blob: web.blob });
      }

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
  return {
    input: cloned as T,
    nodeFiles,
    webFiles,
  } as BuiltUniversalManifest<T>;
}
