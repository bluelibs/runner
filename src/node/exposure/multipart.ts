import type { IncomingMessage } from "http";
import { PassThrough } from "node:stream";
import busboyFactory = require("busboy");
import type { FileInfo, FieldInfo } from "busboy";

import { NodeInputFile } from "../inputFile.node";
import type { InputFileMeta, EjsonFileSentinel } from "../../types/inputFile";
import { jsonErrorResponse } from "./httpResponse";
import type { JsonResponse } from "./types";

export async function parseMultipartInput(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; response: JsonResponse }> {
  const fileStreams = new Map<string, NodeInputFile>();
  let manifestRaw = "";

  await new Promise<void>((resolve, reject) => {
    const bb = busboyFactory({ headers: req.headers });
    const finish = () => resolve();
    bb.on("field", (name: string, value: string, _info: FieldInfo) => {
      if (name === "__manifest") {
        manifestRaw += value;
      }
    });
    bb.on(
      "file",
      (name: string, stream: NodeJS.ReadableStream, info: FileInfo) => {
        if (typeof name === "string" && name.startsWith("file:")) {
          const id = name.slice("file:".length);
          const meta: InputFileMeta = {
            name: info.filename,
            type: info.mimeType,
          };
          const pass = new PassThrough();
          stream.pipe(pass);
          const inputFile = new NodeInputFile(meta, pass);
          fileStreams.set(id, inputFile);
        } else {
          stream.resume();
        }
      },
    );
    bb.on("error", reject);
    bb.on("close", finish);
    bb.on("finish", finish);
    req.on("error", reject);
    req.pipe(bb);
  });

  let manifest: { input?: unknown } | undefined;
  try {
    manifest = manifestRaw ? JSON.parse(manifestRaw) : undefined;
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse(
        400,
        "Invalid manifest",
        "INVALID_MULTIPART",
      ),
    };
  }

  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      response: jsonErrorResponse(400, "Missing manifest", "MISSING_MANIFEST"),
    };
  }

  const hydrated = hydrateInputWithFiles(manifest.input, fileStreams);
  return { ok: true, value: hydrated };
}

export function isMultipart(contentType: string): boolean {
  return /multipart\/form-data/i.test(contentType);
}

function hydrateInputWithFiles(
  input: unknown,
  files: Map<string, NodeInputFile>,
): unknown {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (isEjsonFileSentinel(value)) {
      const file = files.get(value.id);
      if (!file) {
        throw new Error(`Missing file part for id ${value.id}`);
      }
      if (value.meta) {
        file.name = value.meta.name ?? file.name;
        file.type = value.meta.type ?? file.type;
        file.size = value.meta.size ?? file.size;
        file.lastModified = value.meta.lastModified ?? file.lastModified;
        file.extra = value.meta.extra ?? file.extra;
      }
      return file;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = visit((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  return visit(input);
}

function isEjsonFileSentinel(value: unknown): value is EjsonFileSentinel {
  return (
    !!value &&
    typeof value === "object" &&
    (value as EjsonFileSentinel).$ejson === "File" &&
    typeof (value as EjsonFileSentinel).id === "string"
  );
}
