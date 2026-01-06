import type { InputFileMeta, RunnerFileSentinel } from "../types/inputFile";

/**
 * Browser/edge-friendly File sentinel creator.
 * Produces the public File sentinel shape with a browser sidecar `_web`.
 * The sidecar will be stripped out by the universal manifest walker before upload.
 */
export function createWebFile(
  meta: InputFileMeta,
  blob: Blob,
  id: string = "F1",
): RunnerFileSentinel & { _web: { blob: Blob } } {
  return {
    $runnerFile: "File",
    id,
    meta,
    _web: { blob },
  } as any;
}
