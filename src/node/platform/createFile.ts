import type { Readable } from "stream";
import type { InputFileMeta, EjsonFileSentinel } from "../../types/inputFile";

export interface NodeFileSource {
  stream?: Readable;
  buffer?: Buffer;
}

export function createFile(
  meta: InputFileMeta,
  source: NodeFileSource,
  id: string = "F1",
): EjsonFileSentinel & { _node: NodeFileSource } {
  return {
    $ejson: "File",
    id,
    meta,
    _node: source,
  } as any;
}
