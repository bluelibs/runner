import { Readable } from "stream";
import type { buildNodeManifest } from "../upload/manifest";

function escapeHeaderValue(value: string): string {
  return value.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

/**
 * Encodes a serialized manifest and local file sources into a multipart/form-data stream.
 */
export function encodeMultipart(
  manifestText: string,
  files: ReturnType<typeof buildNodeManifest>["files"],
  boundary: string,
): Readable {
  async function* gen(): AsyncGenerator<Buffer> {
    const CRLF = "\r\n";
    const boundaryLine = `--${boundary}`;

    const partHeader = (
      name: string,
      options?: { headers?: Record<string, string>; filename?: string },
    ) => {
      const h: string[] = [boundaryLine + CRLF];
      const cd: string[] = [
        `Content-Disposition: form-data; name="${escapeHeaderValue(name)}"`,
      ];
      if (options?.filename) {
        cd.push(`; filename="${escapeHeaderValue(options.filename)}"`);
      }
      h.push(cd.join("") + CRLF);
      if (options?.headers) {
        for (const k of Object.keys(options.headers)) {
          h.push(`${k}: ${options.headers[k]}` + CRLF);
        }
      }
      h.push(CRLF);
      return Buffer.from(h.join(""), "utf8");
    };

    // __manifest field
    yield partHeader("__manifest");
    yield Buffer.from(manifestText, "utf8");
    yield Buffer.from(CRLF, "utf8");

    for (const entry of files) {
      const filename = entry.meta?.name ?? "upload";
      const contentType = entry.meta?.type ?? "application/octet-stream";
      const headers: Record<string, string> = {
        "Content-Type": contentType,
      };
      yield partHeader(`file:${entry.id}`, { headers, filename });
      if (entry.source.type === "buffer") {
        yield entry.source.buffer;
      } else {
        for await (const chunk of entry.source.stream) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        }
      }
      yield Buffer.from(CRLF, "utf8");
    }
    // Closing boundary
    yield Buffer.from(boundaryLine + "--" + CRLF, "utf8");
  }
  return Readable.from(gen());
}
