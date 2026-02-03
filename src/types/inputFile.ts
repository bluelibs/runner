export interface InputFileMeta {
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  // Additional metadata as needed by callers
  extra?: Record<string, unknown>;
}

/** Universal interface exposed to tasks for streamed files. */
export interface InputFile<TStream = unknown> extends InputFileMeta {
  /**
   * Resolve the underlying stream for one-time consumption.
   * Implementations must enforce single-use semantics.
   */
  resolve(): Promise<{ stream: TStream }>;

  /**
   * Return the underlying stream (single-use). Should throw if already consumed.
   */
  stream(): TStream;

  /**
   * Persist the stream to a temporary file on disk and return its path and number of bytes written.
   */
  toTempFile(dir?: string): Promise<{ path: string; bytesWritten: number }>;
}

/** Client-side sentinel to declare file presence in an input structure. */
export interface RunnerFileSentinel {
  $runnerFile: "File";
  id: string;
  meta: InputFileMeta;
}
