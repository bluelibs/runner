import type { Readable } from "stream";
import type { InputFileMeta, RunnerFileSentinel } from "../../types/inputFile";

export interface NodeFileSource {
  stream?: Readable;
  buffer?: Buffer;
}

export function createFile(
  meta: InputFileMeta,
  source: NodeFileSource,
  id: string = "F1",
): RunnerFileSentinel & { _node: NodeFileSource } {
  // Type assertion needed: returning a sentinel object that satisfies the interface
  // but doesn't implement the full InputFile methods (those are added by NodeInputFile)
  return {
    $runnerFile: "File",
    id,
    meta,
    _node: source,
  } as RunnerFileSentinel & { _node: NodeFileSource };
}
