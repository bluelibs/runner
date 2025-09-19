import type { InputFileMeta, EjsonFileSentinel } from "../types/inputFile";

/**
 * Browser/edge-friendly File sentinel creator.
 * Produces the same public EJSON File shape with a browser sidecar `_web`.
 * The sidecar will be stripped out by the universal manifest walker before upload.
 */
export function createWebFile(
  meta: InputFileMeta,
  blob: Blob,
  id: string = "F1",
): EjsonFileSentinel & { _web: { blob: Blob } } {
  return {
    $ejson: "File",
    id,
    meta,
    _web: { blob },
  } as any;
}


