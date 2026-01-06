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

export interface BuiltUniversalManifest<T = any> {
  input: T; // cloned input with sidecars removed
  nodeFiles: NodeCollectedFile[];
  webFiles: WebCollectedFile[];
}

type AnyObj = Record<string, any>;

export function buildUniversalManifest<T = any>(
  input: T,
): BuiltUniversalManifest<T> {
  const nodeFiles: NodeCollectedFile[] = [];
  const webFiles: WebCollectedFile[] = [];

  function visit(value: any): any {
    if (!value || typeof value !== "object") return value;

    if (
      (value as RunnerFileSentinel).$runnerFile === "File" &&
      typeof (value as any).id === "string"
    ) {
      const v: any = value;
      const id: string = v.id;
      const meta: InputFileMeta = v.meta;
      const node = v._node as
        | { buffer?: Buffer; stream?: Readable }
        | undefined;
      const web = v._web as { blob?: Blob } | undefined;

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
