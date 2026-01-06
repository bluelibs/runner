import type { Readable } from "stream";
import type { InputFileMeta, RunnerFileSentinel } from "../types/inputFile";

export interface NodeFileSource {
  stream?: Readable;
  buffer?: Buffer;
}

export function createNodeFile(
  meta: InputFileMeta,
  source: NodeFileSource,
  id: string = "F1",
): RunnerFileSentinel & { _node: NodeFileSource } {
  return {
    $runnerFile: "File",
    id,
    meta,
    _node: source,
  } as any;
}
