import type { IncomingHttpHeaders } from "http";
import { PassThrough } from "node:stream";
import * as Busboy from "busboy";
import type { FileInfo, FieldInfo } from "busboy";

// Handle both ESM and CJS interop
const busboyFactory: (cfg: {
  headers: IncomingHttpHeaders;
}) => any = (Busboy as any).default || Busboy;

import type { Serializer } from "../../globals/resources/tunnel/serializer";
// Import with explicit .ts extension to prevent tsup from resolving it
// via the native-node-modules plugin (which looks for paths ending in .node)
import { NodeInputFile } from "../inputFile.model";
import type { InputFileMeta, EjsonFileSentinel } from "../../types/inputFile";
import { jsonErrorResponse } from "./httpResponse";
import type { JsonResponse } from "./types";

interface MultipartFinalizeOk {
  ok: true;
}

interface MultipartFinalizeError {
  ok: false;
  response: JsonResponse;
}

export type MultipartFinalizeResult =
  | MultipartFinalizeOk
  | MultipartFinalizeError;

interface MultipartSuccess {
  ok: true;
  value: unknown;
  finalize: Promise<MultipartFinalizeResult>;
}

type MultipartResult = MultipartSuccess | { ok: false; response: JsonResponse };

interface FileEntry {
  id: string;
  file: NodeInputFile;
  stream: PassThrough;
  connected: boolean;
  expected: boolean;
  manifestMeta?: Partial<InputFileMeta>;
}

export interface MultipartRequest extends NodeJS.ReadableStream {
  headers: IncomingHttpHeaders;
  method?: string;
}

export async function parseMultipartInput(
  req: MultipartRequest,
  signal?: AbortSignal,
  serializer?: Serializer,
): Promise<MultipartResult> {
  const files = new Map<string, FileEntry>();
  let manifestRaw = "";
  let manifestSeen = false;
  let readyResolved = false;
  let finalizeSettled = false;
  // Track if upstream request aborted/errored to give it precedence
  let requestAborted = false;

  let resolveReady: (value: MultipartResult) => void;
  const readyPromise = new Promise<MultipartResult>((resolve) => {
    resolveReady = resolve;
  });

  let resolveFinalize: (value: MultipartFinalizeResult) => void;
  const finalizePromise = new Promise<MultipartFinalizeResult>((resolve) => {
    resolveFinalize = resolve;
  });

  const settleFinalize = (value: MultipartFinalizeResult) => {
    if (!finalizeSettled) {
      finalizeSettled = true;
      resolveFinalize(value);
    }
  };

  const ensureEntry = (
    id: string,
    meta?: InputFileMeta,
    source: "manifest" | "file" = "manifest",
  ): FileEntry => {
    let entry = files.get(id);
    if (!entry) {
      const pass = new PassThrough();
      const file = new NodeInputFile(
        {
          name: meta?.name ?? "upload",
        },
        pass,
      );
      entry = { id, file, stream: pass, connected: false, expected: false };
      files.set(id, entry);
    }
    if (meta) {
      applyMeta(entry, meta, source);
    }
    if (source === "manifest") {
      entry.expected = true;
    }
    return entry;
  };

  let busboyInst: any | undefined;

  const endAllStreamsSafely = () => {
    // Ensure any PassThrough streams created for expected files are closed
    for (const entry of files.values()) {
      if (!entry.connected) {
        try {
          entry.stream.end();
        } catch {
          // best-effort; ignore
        }
      }
    }
  };

  const fail = (response: JsonResponse) => {
    try {
      if (busboyInst && typeof (req as any).unpipe === "function") {
        (req as any).unpipe(busboyInst as any);
      }
    } catch {
      // ignore
    }
    try {
      if (typeof (req as any).resume === "function") {
        (req as any).resume();
      }
    } catch {
      // ignore
    }
    // Prevent tasks from hanging waiting on never-connected streams
    endAllStreamsSafely();
    settleFinalize({ ok: false, response });
    if (!readyResolved) {
      readyResolved = true;
      resolveReady({ ok: false, response });
    }
  };

  try {
    busboyInst = busboyFactory({ headers: req.headers });
  } catch {
    fail(
      jsonErrorResponse(400, "Invalid multipart payload", "INVALID_MULTIPART"),
    );
    return await readyPromise;
  }

  busboyInst.on("field", (name: string, value: unknown, _info: FieldInfo) => {
    if (name !== "__manifest") return;
    manifestSeen = true;
    try {
      // Safely coerce to string; this may throw for exotic objects
      const text = typeof value === "string" ? value : String(value);
      manifestRaw += text;
      const manifest = manifestRaw
        ? (serializer as Serializer).parse<{ input?: unknown }>(manifestRaw)
        : undefined;
      if (!manifest || typeof manifest !== "object") {
        fail(jsonErrorResponse(400, "Missing manifest", "MISSING_MANIFEST"));
        return;
      }
      if (!readyResolved) {
        const hydrated = hydrateInputWithFiles(manifest.input, ensureEntry);
        readyResolved = true;
        resolveReady({ ok: true, value: hydrated, finalize: finalizePromise });
      }
    } catch {
      fail(jsonErrorResponse(400, "Invalid manifest", "INVALID_MULTIPART"));
    }
  });

  busboyInst.on(
    "file",
    (name: string, stream: NodeJS.ReadableStream, info: FileInfo) => {
      if (typeof name !== "string" || !name.startsWith("file:")) {
        stream.resume();
        return;
      }
      const id = name.slice("file:".length);
      type ExtendedFileInfo = FileInfo & {
        size?: number;
        lastModified?: number;
        extra?: Record<string, unknown>;
      };
      const ext = info as ExtendedFileInfo;
      const entry = ensureEntry(
        id,
        {
          name: info.filename,
          type: info.mimeType,
          ...(ext.size !== undefined ? { size: ext.size } : {}),
          ...(ext.lastModified !== undefined
            ? { lastModified: ext.lastModified }
            : {}),
          ...(ext.extra !== undefined ? { extra: ext.extra } : {}),
        },
        "file",
      );
      entry.connected = true;
      stream.on("error", () => {
        fail(jsonErrorResponse(500, "Multipart stream error", "STREAM_ERROR"));
      });
      stream.pipe(entry.stream);
    },
  );

  const handleCompletion = () => {
    if (!readyResolved) {
      // If we reached completion without resolving the manifest,
      // treat this as a missing manifest. With current field handler
      // logic, a seen-but-invalid manifest fails earlier.
      fail(jsonErrorResponse(400, "Missing manifest", "MISSING_MANIFEST"));
      return;
    }
    for (const entry of files.values()) {
      if (entry.expected && !entry.connected) {
        fail(
          jsonErrorResponse(
            500,
            `Missing file part for id ${entry.id}`,
            "MISSING_FILE_PART",
          ),
        );
        return;
      }
      if (entry.manifestMeta) {
        applyMeta(entry, entry.manifestMeta, "manifest");
      }
    }
    // All inputs connected; no need to force-end streams here because busboy piping
    // will end PassThrough streams automatically. Still, be defensive for consumers
    // which might not have attached listeners yet.
    settleFinalize({ ok: true });
  };

  // Proxy busboy parser errors to INVALID_MULTIPART, but prefer request aborts.
  busboyInst.once("error", () => {
    // Even if a request abort happened, subsequent fail() is a no-op due to settled state
    fail(
      jsonErrorResponse(400, "Invalid multipart payload", "INVALID_MULTIPART"),
    );
  });

  busboyInst.on("close", handleCompletion);
  busboyInst.on("finish", handleCompletion);

  const onAbort = () => {
    requestAborted = true;
    fail(jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"));
  };
  req.on("error", onAbort);

  if (signal) {
    if ((signal as any).aborted) onAbort();
    signal.addEventListener("abort", onAbort as any, { once: true });
  }

  req.pipe(busboyInst);

  return await readyPromise;
}

export function isMultipart(contentType: string): boolean {
  return /multipart\/form-data/i.test(contentType);
}

function hydrateInputWithFiles(
  input: unknown,
  ensureEntry: (
    id: string,
    meta?: InputFileMeta,
    source?: "manifest" | "file",
  ) => FileEntry,
): unknown {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (isEjsonFileSentinel(value)) {
      const entry = ensureEntry(value.id, value.meta);
      return entry.file;
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

const DEFAULT_NAME = "upload";

function applyMeta(
  entry: FileEntry,
  meta: Partial<InputFileMeta>,
  source: "manifest" | "file",
): void {
  const file = entry.file;

  if (source === "manifest") {
    entry.manifestMeta = { ...(entry.manifestMeta ?? {}), ...meta };
  }

  const manifestHas = <K extends keyof InputFileMeta>(key: K): boolean => {
    return entry.manifestMeta ? entry.manifestMeta[key] !== undefined : false;
  };

  if (meta.name !== undefined) {
    if (source === "manifest") {
      file.name = meta.name;
    } else if (
      !manifestHas("name") &&
      (!file.name || file.name === DEFAULT_NAME)
    ) {
      file.name = meta.name;
    }
  }

  if (meta.type !== undefined) {
    if (
      source === "manifest" ||
      (!manifestHas("type") && file.type === undefined)
    ) {
      file.type = meta.type;
    }
  }

  if (meta.size !== undefined) {
    if (
      source === "manifest" ||
      (!manifestHas("size") && file.size === undefined)
    ) {
      file.size = meta.size;
    }
  }

  if (meta.lastModified !== undefined) {
    if (
      source === "manifest" ||
      (!manifestHas("lastModified") && file.lastModified === undefined)
    ) {
      file.lastModified = meta.lastModified;
    }
  }

  if (meta.extra !== undefined) {
    if (
      source === "manifest" ||
      (!manifestHas("extra") && file.extra === undefined)
    ) {
      file.extra = meta.extra;
    }
  }
}

function isEjsonFileSentinel(value: unknown): value is EjsonFileSentinel {
  return (
    !!value &&
    typeof value === "object" &&
    (value as EjsonFileSentinel).$ejson === "File" &&
    typeof (value as EjsonFileSentinel).id === "string"
  );
}
