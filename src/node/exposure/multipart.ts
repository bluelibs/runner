import type { IncomingHttpHeaders } from "http";
import { PassThrough } from "node:stream";
import * as Busboy from "busboy";
import type { FileInfo, FieldInfo } from "busboy";

// Handle both ESM and CJS interop
const busboyFactory: (cfg: {
  headers: IncomingHttpHeaders;
  limits?: MultipartLimits;
}) => unknown = (() => {
  const mod = Busboy as unknown as { default?: unknown };
  if (typeof mod.default === "function") {
    return mod.default as (cfg: {
      headers: IncomingHttpHeaders;
      limits?: MultipartLimits;
    }) => unknown;
  }
  return Busboy as unknown as (cfg: {
    headers: IncomingHttpHeaders;
    limits?: MultipartLimits;
  }) => unknown;
})();

import type { SerializerLike } from "../../serializer";
// Import with explicit .ts extension to prevent tsup from resolving it
// via the native-node-modules plugin (which looks for paths ending in .node)
import { NodeInputFile } from "../files/inputFile.model";
import type { InputFileMeta, RunnerFileSentinel } from "../../types/inputFile";
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

enum MultipartLimitErrorMessage {
  LimitExceeded = "Multipart limit exceeded",
}

class MultipartLimitError extends Error {
  readonly response: JsonResponse;

  constructor(response: JsonResponse) {
    super(MultipartLimitErrorMessage.LimitExceeded);
    this.response = response;
  }
}

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

export interface MultipartLimits {
  fieldNameSize?: number;
  fieldSize?: number;
  fields?: number;
  fileSize?: number;
  files?: number;
  parts?: number;
  headerPairs?: number;
}

const DEFAULT_LIMITS: MultipartLimits = {
  fileSize: 20 * 1024 * 1024, // 20MB
  files: 10,
  fields: 100,
  fieldSize: 1 * 1024 * 1024, // 1MB
};

export async function parseMultipartInput(
  req: MultipartRequest,
  signal: AbortSignal | undefined,
  serializer: SerializerLike,
  limits: MultipartLimits = DEFAULT_LIMITS,
): Promise<MultipartResult> {
  const files = new Map<string, FileEntry>();
  let manifestRaw = "";
  let manifestBytes = 0;
  let _manifestSeen = false;
  let readyResolved = false;
  let finalizeSettled = false;
  // Track if upstream request aborted/errored to give it precedence
  let _requestAborted = false;

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
      const maxFiles = limits.files;
      if (typeof maxFiles === "number" && files.size >= maxFiles) {
        throw new MultipartLimitError(payloadTooLarge("Files limit exceeded"));
      }
      const pass = new PassThrough();
      pass.on("error", () => {
        // Avoid unhandled error events when we abort multipart streams.
      });
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

  const destroyAllStreamsSafely = () => {
    const error = new Error();
    for (const entry of files.values()) {
      if (entry.stream.destroyed) continue;
      try {
        entry.stream.destroy(error);
      } catch {
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
      const unpipe = (req as { unpipe?: (dest: unknown) => unknown }).unpipe;
      if (busboyInst && typeof unpipe === "function") unpipe(busboyInst);
    } catch {
      // ignore
    }
    try {
      const resume = (req as { resume?: () => unknown }).resume;
      if (typeof resume === "function") resume();
    } catch {
      // ignore
    }
    // Prevent tasks from hanging waiting on never-connected streams
    destroyAllStreamsSafely();
    settleFinalize({ ok: false, response });
    if (!readyResolved) {
      readyResolved = true;
      resolveReady({ ok: false, response });
    }
  };

  const payloadTooLarge = (msg: string) =>
    jsonErrorResponse(413, msg, "PAYLOAD_TOO_LARGE");

  try {
    busboyInst = busboyFactory({ headers: req.headers, limits });
  } catch {
    fail(
      jsonErrorResponse(400, "Invalid multipart payload", "INVALID_MULTIPART"),
    );
    return await readyPromise;
  }

  const appendManifestChunk = (chunk: string): boolean => {
    const maxFieldSize = limits.fieldSize;
    if (typeof maxFieldSize === "number") {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (manifestBytes + chunkBytes > maxFieldSize) {
        fail(payloadTooLarge("Field limit exceeded"));
        return false;
      }
      manifestBytes += chunkBytes;
    }
    manifestRaw += chunk;
    return true;
  };

  busboyInst.on("field", (name: string, value: unknown, info: FieldInfo) => {
    if (info.nameTruncated || info.valueTruncated) {
      fail(payloadTooLarge("Field limit exceeded"));
      return;
    }
    if (name !== "__manifest") return;
    _manifestSeen = true;
    try {
      // Safely coerce to string; this may throw for exotic objects
      const text = typeof value === "string" ? value : String(value);
      if (!appendManifestChunk(text)) {
        return;
      }
      const manifest = manifestRaw
        ? serializer.parse<{ input?: unknown }>(manifestRaw)
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
    } catch (error) {
      if (error instanceof MultipartLimitError) {
        fail(error.response);
        return;
      }
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
      let entry: FileEntry;
      try {
        entry = ensureEntry(
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
      } catch (error) {
        if (error instanceof MultipartLimitError) {
          fail(error.response);
          stream.resume();
          return;
        }
        throw error;
      }
      entry.connected = true;

      // Busboy emits 'limit' event on the file stream if fileSize limit is reached
      stream.on("limit", () => {
        fail(payloadTooLarge("File size limit exceeded"));
      });
      stream.on("error", () => {
        fail(jsonErrorResponse(500, "Multipart stream error", "STREAM_ERROR"));
      });
      stream.pipe(entry.stream);
    },
  );

  busboyInst.on("fieldsLimit", () =>
    fail(payloadTooLarge("Fields limit exceeded")),
  );
  busboyInst.on("filesLimit", () =>
    fail(payloadTooLarge("Files limit exceeded")),
  );
  busboyInst.on("partsLimit", () =>
    fail(payloadTooLarge("Parts limit exceeded")),
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
    _requestAborted = true;
    fail(jsonErrorResponse(499, "Client Closed Request", "REQUEST_ABORTED"));
  };
  req.on("error", onAbort);

  if (signal) {
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
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
    if (isRunnerFileSentinel(value)) {
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

function isRunnerFileSentinel(value: unknown): value is RunnerFileSentinel {
  return (
    !!value &&
    typeof value === "object" &&
    (value as RunnerFileSentinel).$runnerFile === "File" &&
    typeof (value as RunnerFileSentinel).id === "string"
  );
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

// End of file
