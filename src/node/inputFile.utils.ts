import type { InputFile } from "../types/inputFile";
import { pipeline, Transform } from "stream";
import type { Readable } from "stream";
import * as fs from "fs";

/**
 * Read an InputFile's contents fully into memory as a Buffer.
 * Note: InputFile streams are single-use; this will consume it.
 */
export async function readInputFileToBuffer(
  file: InputFile<Readable>,
): Promise<Buffer> {
  const { stream } = await file.resolve();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (chunk !== undefined && chunk !== null) {
        // Fall back to stringification
        chunks.push(Buffer.from(String(chunk)));
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", (err) => reject(err));
  });
  return Buffer.concat(chunks as readonly Uint8Array[]);
}

/**
 * Write an InputFile's contents to a specific path, returning bytesWritten.
 * Note: InputFile streams are single-use; this will consume it.
 */
export async function writeInputFileToPath(
  file: InputFile<Readable>,
  targetPath: string,
): Promise<{ bytesWritten: number }> {
  const { stream } = await file.resolve();
  await fs.promises.mkdir(require("path").dirname(targetPath), {
    recursive: true,
  });
  const write = fs.createWriteStream(targetPath);
  let bytesWritten = 0;
  // Normalize chunks into Buffer to satisfy fs.WriteStream and track length
  const normalize = new Transform({
    writableObjectMode: true,
    transform(chunk, _enc, cb) {
      const out: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk));
      bytesWritten += out.length;
      cb(null, out);
    },
  });
  await new Promise<void>((resolve, reject) => {
    pipeline(stream, normalize, write, (err) =>
      err ? reject(err) : resolve(),
    );
  });
  return { bytesWritten };
}
