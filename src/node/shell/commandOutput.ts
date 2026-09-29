/** Maximum captured command output, excluding the truncation notice. */
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
/** JSON escaping can expand a byte to a six-character Unicode escape. */
export const MAX_COMMAND_RESPONSE_BYTES = MAX_COMMAND_OUTPUT_BYTES * 6 + 1024;
const notice = "\n[Shell output truncated at 1 MiB]\n";

/** Retains a bounded prefix without keeping oversized backing buffers alive. */
export function createCommandOutput() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    write(chunk: Buffer): void {
      const remaining = MAX_COMMAND_OUTPUT_BYTES - bytes;
      const retained = chunk.subarray(0, remaining);
      if (retained.length) chunks.push(Buffer.from(retained));
      bytes += retained.length;
      truncated ||= chunk.length > remaining;
    },
    read(): string {
      return Buffer.concat(chunks).toString("utf8") + (truncated ? notice : "");
    },
    clear(): void {
      chunks.length = 0;
    },
  };
}
