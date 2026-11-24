import { Readable } from "stream";
import type { buildNodeManifest } from "../upload/manifest";

const CRLF = "\r\n";
const CRLF_BUFFER = Buffer.from(CRLF, "utf8");

function escapeHeaderValue(value: string): string {
  return value.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function formatPartHeader(
  boundaryLine: string,
  name: string,
  options?: { headers?: Record<string, string>; filename?: string },
): string {
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
  return h.join("");
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
    const boundaryLine = `--${boundary}`;

    // Coalesce static manifest header, JSON text, and trailing CRLF into one buffer.
    yield Buffer.from(
      formatPartHeader(boundaryLine, "__manifest") + manifestText + CRLF,
      "utf8",
    );

    for (const entry of files) {
      const filename = entry.meta?.name ?? "upload";
      const contentType = entry.meta?.type ?? "application/octet-stream";
      yield Buffer.from(
        formatPartHeader(boundaryLine, `file:${entry.id}`, {
          headers: { "Content-Type": contentType },
          filename,
        }),
        "utf8",
      );
      if (entry.source.type === "buffer") {
        yield entry.source.buffer;
      } else {
        for await (const chunk of entry.source.stream) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        }
      }
      yield CRLF_BUFFER;
    }
    // Closing boundary
    yield Buffer.from(`${boundaryLine}--${CRLF}`, "utf8");
  }
  return Readable.from(gen());
}
