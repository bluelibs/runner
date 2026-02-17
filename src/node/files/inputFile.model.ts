import type { InputFile } from "../../types/inputFile";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pipeline } from "stream";
import { Readable, PassThrough } from "stream";
import {
  nodeInputFileConsumedError,
  nodeInputFileUnavailableError,
} from "../../errors";

export type NodeReadable = Readable;

export class NodeInputFile implements InputFile<NodeReadable> {
  name: string;
  type?: string | undefined;
  size?: number | undefined;
  lastModified?: number | undefined;
  extra?: Record<string, unknown> | undefined;

  private _stream: NodeReadable | null;
  private _consumed = false;

  constructor(
    meta: Omit<InputFile<NodeReadable>, "resolve" | "stream" | "toTempFile">,
    stream: NodeReadable,
  ) {
    this.name = meta.name;
    this.type = meta.type;
    this.size = meta.size;
    this.lastModified = meta.lastModified;
    this.extra = meta.extra;
    this._stream = stream;
  }

  async resolve(): Promise<{ stream: NodeReadable }> {
    return { stream: this.stream() };
  }

  stream(): NodeReadable {
    if (this._consumed) {
      nodeInputFileConsumedError.throw();
    }
    if (!this._stream) {
      nodeInputFileUnavailableError.throw();
    }
    this._consumed = true;
    return this._stream!;
  }

  async toTempFile(
    dir?: string,
  ): Promise<{ path: string; bytesWritten: number }> {
    const targetDir = dir || os.tmpdir();
    const filePath = path.join(targetDir, uniqueTempName(this.name));
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const write = fs.createWriteStream(filePath);
    const src = this.stream();
    let bytes = 0;
    src.on("data", (c: any) => {
      bytes += c.length;
    });

    await new Promise<void>((resolve, reject) => {
      pipeline(src, write, (err) => (err ? reject(err) : resolve()));
    });
    return { path: filePath, bytesWritten: bytes };
  }
}

function uniqueTempName(basename: string): string {
  const safe =
    basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "upload";
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  return `${safe}.${ts}.${rnd}`;
}

export function toPassThrough(stream: NodeReadable): NodeReadable {
  // Ensure we return a distinct stream if upstream reuses references
  const pt = new PassThrough();
  stream.pipe(pt);
  return pt;
}
