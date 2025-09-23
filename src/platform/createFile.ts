import type { InputFileMeta, EjsonFileSentinel } from "../types/inputFile";
import { createWebFile } from "./createWebFile";

/**
 * Universal/browser `createFile` helper. For Node, import from `@bluelibs/runner/node`.
 */
export function createFile(
  meta: InputFileMeta,
  blob: Blob,
  id: string = "F1",
): EjsonFileSentinel & { _web: { blob: Blob } } {
  return createWebFile(meta, blob, id);
}

export type { EjsonFileSentinel };
